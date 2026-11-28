import { createClient } from '@libsql/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeProspect, checkFreshness, publicProfile, WorkflowError } from './prospect.mjs';
import { checkoutModeForOffer, currentOffer, launchOffer, offersForApproval } from './offer.mjs';

const schema = [
  `CREATE TABLE IF NOT EXISTS prospects (
    id TEXT PRIMARY KEY, business_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, share_token TEXT UNIQUE, approved_at TEXT,
    attempt TEXT, checkout_id TEXT UNIQUE, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    prospect_id TEXT PRIMARY KEY REFERENCES prospects(id), checkout_id TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL, currency TEXT NOT NULL, provider TEXT NOT NULL,
    paid_at TEXT NOT NULL, delivered_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS order_deliveries (
    prospect_id TEXT PRIMARY KEY REFERENCES orders(prospect_id), site_url TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS order_subscriptions (
    prospect_id TEXT PRIMARY KEY REFERENCES orders(prospect_id), subscription_id TEXT NOT NULL
  )`,
];

const now = () => new Date().toISOString();
const select = `SELECT p.*, o.paid_at, o.delivered_at, o.provider, o.checkout_id AS receipt_id, d.site_url, s.subscription_id
  FROM prospects p LEFT JOIN orders o ON p.id = o.prospect_id
  LEFT JOIN order_deliveries d ON o.prospect_id = d.prospect_id
  LEFT JOIN order_subscriptions s ON o.prospect_id = s.prospect_id`;
const pageSize = 100;

function matchesCheckout(lead, event) {
  return lead?.share_token && lead.attempt === event.attempt &&
    lead.offer.amount === event.amount && lead.offer.version === event.version &&
    lead.data.currency === event.currency && checkoutModeForOffer(lead.offer) === (event.mode ?? 'payment');
}

function deliveryUrl(value) {
  const invalid = () => new WorkflowError('Enter the published site’s HTTPS URL without credentials or URL parameters.');
  if (typeof value !== 'string' || value.length > 1000) throw invalid();
  const input = value.trim();
  if (!/^https:\/\/[^/]/i.test(input) || /[\s\\?#]/u.test(input)) throw invalid();
  let url;
  try { url = new URL(input); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password) throw invalid();
  return url.href;
}

export async function createStore(config, offer = currentOffer) {
  const db = createClient(config);
  try { await db.batch(schema, 'write'); } catch (err) { db.close(); throw err; }
  const execute = (sql, args = []) => db.execute({ sql, args });
  const hydrate = row => {
    if (!row) return row;
    const { offer: approvedOffer, ...data } = JSON.parse(String(row.payload));
    return { ...row, data, offer: row.share_token ? approvedOffer ?? launchOffer : offer };
  };
  const find = async id => hydrate((await execute(select + ' WHERE p.id = ?', [id])).rows[0]);
  const resetExpiredSession = async (id, attempt, sessionId) => {
    await execute(`UPDATE prospects SET attempt = ?, checkout_id = NULL WHERE id = ? AND attempt = ? AND checkout_id = ?
      AND NOT EXISTS (SELECT 1 FROM orders WHERE prospect_id = ?)`, [randomUUID(), id, attempt, sessionId, id]);
    return find(id);
  };
  return {
    close: () => db.close(),
    async list(page = 1) {
      const { rows } = await execute(`SELECT p.id, p.share_token, o.paid_at, o.delivered_at,
        (SELECT json_extract(f.value, '$.value') FROM json_each(p.payload, '$.facts') f
          WHERE json_extract(f.value, '$.field') = 'name' LIMIT 1) AS name
        FROM prospects p LEFT JOIN orders o ON p.id = o.prospect_id
        ORDER BY (o.paid_at IS NOT NULL AND o.delivered_at IS NULL) DESC, p.created_at DESC, p.rowid DESC
        LIMIT ? OFFSET ?`, [pageSize + 1, (page - 1) * pageSize]);
      return { leads: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
    },
    async counts() {
      const { rows } = await execute(`SELECT
        count(CASE WHEN p.share_token IS NULL THEN 1 END) AS drafts,
        count(CASE WHEN p.share_token IS NOT NULL AND o.paid_at IS NULL THEN 1 END) AS shared,
        count(CASE WHEN o.paid_at IS NOT NULL AND o.delivered_at IS NULL THEN 1 END) AS queued,
        count(o.delivered_at) AS delivered
        FROM prospects p LEFT JOIN orders o ON p.id = o.prospect_id`);
      return rows[0];
    },
    async hasBusiness(key) {
      return (await execute('SELECT 1 FROM prospects WHERE business_key = ?', [key])).rows.length > 0;
    },
    find,
    publicLead: async token => /^[A-Za-z0-9_-]{32}$/.test(token) &&
      hydrate((await execute(select + ' WHERE p.share_token = ?', [token])).rows[0]),
    async save(input, id, revision) {
      const data = normalizeProspect(input);
      const payload = JSON.stringify(data);
      const key = data.businessKey;
      const leadId = id || randomUUID();
      const saved = id
        ? await execute(`UPDATE OR IGNORE prospects SET business_key = ?, payload = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND share_token IS NULL`, [key, payload, id, revision])
        : await execute('INSERT OR IGNORE INTO prospects (id, business_key, payload, created_at) VALUES (?, ?, ?, ?)',
          [leadId, key, payload, now()]);
      if (!saved.rowsAffected) throw new WorkflowError('A duplicate, approved or changed prospect prevented this save. Reload before editing.', 409);
      return leadId;
    },
    async release(id, revision, reviewedOfferVersion = offer.version) {
      const lead = await find(id);
      if (!lead) throw new WorkflowError('Prospect not found.', 404);
      if (lead.share_token) return;
      const approvedOffer = offersForApproval(offer).find(candidate => candidate.version === reviewedOfferVersion);
      if (!approvedOffer) {
        throw new WorkflowError('The offer changed. Reload and review the new terms before approving.', 409);
      }
      checkFreshness(lead.data.facts);
      const saved = await execute(`UPDATE prospects
        SET share_token = ?, approved_at = ?, payload = json_set(payload, '$.offer', json(?))
        WHERE id = ? AND share_token IS NULL AND revision = ?`,
        [randomBytes(24).toString('base64url'), now(), JSON.stringify(approvedOffer), id, revision]);
      if (!saved.rowsAffected) throw new WorkflowError('This prospect changed. Reload and review the evidence again.', 409);
    },
    async revoke(id) {
      const saved = await execute(`UPDATE prospects SET share_token = NULL, approved_at = NULL, revision = revision + 1,
          payload = json_remove(payload, '$.offer')
        WHERE id = ? AND share_token IS NOT NULL AND attempt IS NULL`, [id]);
      if (!saved.rowsAffected) throw new WorkflowError('A preview with a checkout attempt cannot be revoked here.', 409);
    },
    async reserveAttempt(id, token) {
      await execute(`UPDATE prospects SET attempt = ? WHERE id = ? AND share_token = ? AND attempt IS NULL`,
        [randomUUID(), id, token]);
      const lead = await find(id);
      if (lead?.share_token !== token || !lead.attempt) throw new WorkflowError('Preview is unavailable.', 409);
      return lead;
    },
    async recordSession(id, attempt, sessionId) {
      const saved = await execute(`UPDATE prospects SET checkout_id = ?
        WHERE id = ? AND attempt = ? AND (checkout_id IS NULL OR checkout_id = ?)`,
        [sessionId, id, attempt, sessionId]);
      if (!saved.rowsAffected) throw new WorkflowError('Checkout changed. Please open your preview and retry.', 409);
    },
    resetExpiredSession,
    async resetFailedSession(event) {
      const lead = await find(event.id);
      if (matchesCheckout(lead, event)) await resetExpiredSession(event.id, event.attempt, event.sessionId);
    },
    async pay(event) {
      const { id, attempt, sessionId, amount, currency, provider } = event;
      // The offer is immutable once an attempt starts. The insert still checks
      // the attempt in case Stripe expired it while the webhook was in flight.
      if (!matchesCheckout(await find(id), event)) return false;
      const statements = [{
        sql: `INSERT INTO orders (prospect_id, checkout_id, amount, currency, provider, paid_at)
          SELECT id, ?, ?, ?, ?, ? FROM prospects
          WHERE id = ? AND attempt = ? AND share_token IS NOT NULL
            AND json_extract(payload, '$.currency') = ? AND (checkout_id = ? OR checkout_id IS NULL)
          ON CONFLICT(prospect_id) DO NOTHING`,
        args: [sessionId, amount, currency, provider, now(), id, attempt, currency, sessionId],
      }];
      if (event.mode === 'subscription' && event.subscriptionId && provider === 'stripe-test') {
        statements.push({
          sql: `INSERT INTO order_subscriptions (prospect_id, subscription_id)
            SELECT o.prospect_id, ? FROM orders o JOIN prospects p ON p.id = o.prospect_id
            WHERE o.prospect_id = ? AND o.checkout_id = ? AND o.provider = ? AND p.attempt = ?
            ON CONFLICT(prospect_id) DO NOTHING`,
          args: [event.subscriptionId, id, sessionId, provider, attempt],
        });
      }
      const [inserted] = await db.batch(statements, 'write');
      if (inserted.rowsAffected) return true;
      const paid = await find(id);
      return paid?.receipt_id === sessionId && paid.provider === provider && paid.attempt === attempt;
    },
    async markDelivered(id, siteUrl) {
      const url = deliveryUrl(siteUrl);
      const [, saved, order] = await db.batch([
        {
          sql: `INSERT INTO order_deliveries (prospect_id, site_url)
            SELECT prospect_id, ? FROM orders WHERE prospect_id = ?
            ON CONFLICT(prospect_id) DO NOTHING`,
          args: [url, id],
        },
        {
          sql: `UPDATE orders SET delivered_at = COALESCE(delivered_at, ?) WHERE prospect_id = ?
            AND EXISTS (SELECT 1 FROM order_deliveries WHERE prospect_id = orders.prospect_id AND site_url = ?)`,
          args: [now(), id, url],
        },
        { sql: 'SELECT 1 FROM orders WHERE prospect_id = ?', args: [id] },
      ], 'write');
      if (saved.rowsAffected) return;
      if (!order.rows.length) throw new WorkflowError('An order must be paid before delivery.', 409);
      throw new WorkflowError('A different site URL has already been recorded for this order.', 409);
    },
  };
}

let store;
export function getStore() {
  const remote = process.env.SITEBEFORE_DB_URL;
  const authToken = process.env.SITEBEFORE_DB_TOKEN;
  if (!remote && !import.meta.env?.DEV) throw new WorkflowError('Agency storage is unavailable.', 503);
  if (remote && !/^libsql:\/\//.test(remote) && !/^https:\/\//.test(remote)) {
    throw new WorkflowError('Agency storage is unavailable.', 503);
  }
  if (remote && !authToken) throw new WorkflowError('Agency storage is unavailable.', 503);
  if (!store) {
    if (!remote) mkdirSync(resolve('.local'), { recursive: true, mode: 0o700 });
    store = createStore(remote ? { url: remote, authToken } : { url: 'file:.local/sitebefore.db' });
    store.catch(() => { store = undefined; });
  }
  return store;
}

export function prospectSummary(lead) {
  return publicProfile(lead.data);
}

export function simulatedSession(id, attempt) {
  return 'demo_' + createHash('sha256').update(id + ':' + attempt).digest('hex').slice(0, 24);
}
