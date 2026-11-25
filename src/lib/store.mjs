import { createClient } from '@libsql/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeProspect, checkFreshness, publicProfile, WorkflowError } from './prospect.mjs';
import { price, offerVersion } from './offer.mjs';

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
];

const now = () => new Date().toISOString();
const hydrate = row => row && ({ ...row, data: JSON.parse(String(row.payload)) });
const select = `SELECT p.*, o.paid_at, o.delivered_at, o.provider, o.checkout_id AS receipt_id
  FROM prospects p LEFT JOIN orders o ON p.id = o.prospect_id`;

export async function createStore(config) {
  const db = createClient(config);
  try { await db.batch(schema, 'write'); } catch (err) { db.close(); throw err; }
  const execute = (sql, args = []) => db.execute({ sql, args });
  const find = async id => hydrate((await execute(select + ' WHERE p.id = ?', [id])).rows[0]);
  return {
    close: () => db.close(),
    list: async () => (await execute(select + `
      WHERE o.paid_at IS NOT NULL OR p.id IN (
        SELECT id FROM prospects ORDER BY created_at DESC, rowid DESC LIMIT 100
      )
      ORDER BY (o.paid_at IS NOT NULL AND o.delivered_at IS NULL) DESC, p.created_at DESC, p.rowid DESC
    `)).rows.map(hydrate),
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
    async release(id, revision) {
      const lead = await find(id);
      if (!lead) throw new WorkflowError('Prospect not found.', 404);
      if (lead.share_token) return;
      checkFreshness(lead.data.facts);
      const saved = await execute(`UPDATE prospects SET share_token = ?, approved_at = ?
        WHERE id = ? AND share_token IS NULL AND revision = ?`, [randomBytes(24).toString('base64url'), now(), id, revision]);
      if (!saved.rowsAffected) throw new WorkflowError('This prospect changed. Reload and review the evidence again.', 409);
    },
    async revoke(id) {
      const saved = await execute(`UPDATE prospects SET share_token = NULL, approved_at = NULL, revision = revision + 1
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
    async resetExpiredSession(id, attempt, sessionId) {
      await execute(`UPDATE prospects SET attempt = ?, checkout_id = NULL WHERE id = ? AND attempt = ? AND checkout_id = ?
        AND NOT EXISTS (SELECT 1 FROM orders WHERE prospect_id = ?)`, [randomUUID(), id, attempt, sessionId, id]);
      return find(id);
    },
    async pay({ id, attempt, sessionId, amount, currency, version, provider }) {
      if (amount !== price || version !== offerVersion) return false;
      const inserted = await execute(`INSERT INTO orders (prospect_id, checkout_id, amount, currency, provider, paid_at)
        SELECT id, ?, ?, ?, ?, ? FROM prospects
        WHERE id = ? AND attempt = ? AND share_token IS NOT NULL
          AND json_extract(payload, '$.currency') = ? AND (checkout_id = ? OR checkout_id IS NULL)
        ON CONFLICT(prospect_id) DO NOTHING`,
        [sessionId, amount, currency, provider, now(), id, attempt, currency, sessionId]);
      if (inserted.rowsAffected) return true;
      return (await find(id))?.receipt_id === sessionId;
    },
    async markDelivered(id) {
      const saved = await execute(`UPDATE orders SET delivered_at = COALESCE(delivered_at, ?) WHERE prospect_id = ?`, [now(), id]);
      if (!saved.rowsAffected) throw new WorkflowError('An order must be paid before delivery.', 409);
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
