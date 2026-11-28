import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClient } from '@libsql/client';
import Stripe from 'stripe';
import { createStore } from '../src/lib/store.mjs';
import { parseDossierExport } from '../src/lib/dossier-import.mjs';
import { makeDemoProspect } from '../src/data/demo-prospect.mjs';
import { normalizeProspect, checkFreshness, publicProfile } from '../src/lib/prospect.mjs';
import { currentOffer, launchOffer } from '../src/lib/offer.mjs';
import { checkoutMode, checkoutOrigin, failureFromEvent, paymentFromEvent, verifyWebhook } from '../src/lib/checkout.mjs';
import { readForm } from '../src/lib/http.mjs';

const { version: offerVersion, amount: price } = currentOffer;

function exportFixture(retrieved = new Date().toISOString().slice(0, 10)) {
  const source = 'https://example.com/maps/place/gm-auto-care';
  const fact = value => ({ value, source, retrieved, excerpt: value });
  return {
    slug: 'gm-auto-care-mesquite', niche: 'auto_repair', currency: 'USD',
    facts: {
      name: fact('GM Auto Care'), city: fact('Mesquite'),
      address: fact('2301 N Galloway Ave, Mesquite, TX 75150'), phone: fact('(469) 687-5439'),
      maps_url: fact(source), category: fact('Auto repair shop'), website: { value: '', source, retrieved },
      intro: fact('Fixture introduction for workflow testing.'), service: [fact('Fixture service')],
    },
  };
}

test('different Google Maps cids import as separate businesses without tracking parameters affecting identity', async t => {
  const db = await createStore({ url: ':memory:' });
  t.after(() => db.close());
  const input = exportFixture();
  const listing = (cid, suffix = '') => {
    const value = `https://www.google.com/maps?cid=${cid}${suffix}`;
    input.facts.maps_url = { ...input.facts.maps_url, value, excerpt: value };
    return JSON.stringify(input);
  };
  const first = await db.importDossier(listing(111));
  const second = await db.importDossier(listing(222));
  assert.notEqual(second, first);
  assert.equal(await db.importDossier(listing(111, '&hl=en')), first);
  assert.equal((await db.list()).leads.length, 2);
  const prospect = makeDemoProspect();
  assert.equal(normalizeProspect({ ...prospect, businessUrl: 'https://example.com/maps?cid=111' }).businessKey,
    normalizeProspect({ ...prospect, businessUrl: 'https://example.com/maps?cid=222' }).businessKey);
});

test('grounded snapshot facts preserve evidence and report all invalid or contradictory fields', () => {
  const clock = Date.parse('2026-11-28T12:00:00Z');
  const retrieved = '2026-11-01T15:45:00-05:00';
  const input = exportFixture(retrieved);
  const raw = JSON.stringify(input);
  const { dossier, sourceHash, evidence } = parseDossierExport(raw, clock);
  assert.match(sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(dossier.businessUrl, input.facts.maps_url.value);
  assert.deepEqual(dossier.facts.find(fact => fact.field === 'location'), {
    ...input.facts.address, field: 'location', checked: '2026-11-01',
  });
  assert.ok(evidence.some(fact => fact.field === 'city'));
  assert.throws(() => parseDossierExport('', clock), /valid JSON/);
  assert.throws(() => parseDossierExport('{"facts":{}}', clock), /intro: required sourced fact is missing/);
  assert.throws(() => parseDossierExport(raw.replace('"city":', '"name":{},"city":'), clock), /"name": duplicate JSON key/);
  input.facts.address = [input.facts.address, { ...input.facts.address,
    value: '3115 N. Central Expressway, Suite 120, Dallas', excerpt: '3115 N. Central Expressway, Suite 120, Dallas' }];
  input.facts.phone = [input.facts.phone, { ...input.facts.phone,
    value: '(214) 555-0144', excerpt: 'Factory fixture did not substantiate the number.' }];
  input.facts.name.retrieved = '2026-10-19';
  input.facts.city.source = 'http://example.com/listing';
  delete input.facts.category.source;
  delete input.facts.intro.excerpt;
  assert.throws(() => parseDossierExport(JSON.stringify(input), clock), error => {
    for (const message of [
      'Refresh the name evidence', 'address[1], address[2]: contradictory values for location',
      'phone[1], phone[2]: contradictory values for phone', 'phone[2]: the fact value does not appear in the excerpt',
      'city: missing or invalid HTTPS source URL', 'category: missing or invalid HTTPS source URL',
      'intro: provide a captured excerpt',
    ]) assert.ok(error.message.includes(message), message);
    return error.status === 400;
  });
});

test('import deduplicates drafts by hash and business, and never alters a released prospect', async t => {
  const db = await createStore({ url: ':memory:' });
  t.after(() => db.close());
  const input = exportFixture();
  const raw = JSON.stringify(input);
  const id = await db.importDossier(raw);
  const firstImport = await db.latestDossierImport(id);
  assert.equal(firstImport.source_hash, parseDossierExport(raw).sourceHash);
  assert.equal(await db.importDossier(raw), id);
  assert.equal((await db.find(id)).revision, 1);
  assert.deepEqual(await db.latestDossierImport(id), firstImport);
  const outdated = exportFixture('2026-10-19');
  await assert.rejects(db.importDossier(JSON.stringify(outdated)), /maximum age 30 days/);
  assert.deepEqual(await db.latestDossierImport(id), firstImport);
  input.facts.intro.value = input.facts.intro.excerpt = 'Updated fixture introduction.';
  const revised = JSON.stringify(input);
  assert.equal(await db.importDossier(revised), id);
  assert.equal((await db.find(id)).revision, 2);
  const secondImport = await db.latestDossierImport(id);
  assert.notEqual(secondImport.id, firstImport.id);
  assert.equal(await db.importDossier(raw), id);
  assert.equal((await db.find(id)).data.facts.find(fact => fact.field === 'intro').value, 'Updated fixture introduction.');
  await db.release(id, 2);
  const before = await db.find(id);
  await assert.rejects(db.importDossier(revised), { status: 409 });
  await assert.rejects(db.importDossier(revised + '\n'), { status: 409 });
  assert.deepEqual(await db.find(id), before);
  assert.deepEqual(await db.latestDossierImport(id), secondImport);
  assert.equal((await db.list()).leads.length, 1);
});

test('checkout and published links can share one valid configured origin', () => {
  assert.equal(checkoutOrigin('https://preview.example.com/'), 'https://preview.example.com');
  assert.equal(checkoutOrigin('http://localhost:4321', true), 'http://localhost:4321');
  assert.equal(checkoutOrigin('http://localhost:4321', false), null);
  assert.equal(checkoutOrigin('https://preview.example.com/agency'), null);
});

test('dossiers reject unsupported claims and keep raw evidence out of preview data', () => {
  const input = makeDemoProspect();
  assert.equal(publicProfile(normalizeProspect(input)).source, undefined);
  input.facts[0].value = 'An invented business name';
  assert.throws(() => normalizeProspect(input), /evidence excerpt/);
  input.facts[0] = { ...makeDemoProspect().facts[0], source: 'javascript:alert(1)' };
  assert.throws(() => normalizeProspect(input), /HTTPS/);
  input.facts[0] = { ...makeDemoProspect().facts[0], checked: '2026-02-30' };
  assert.throws(() => normalizeProspect(input), /YYYY-MM-DD/);
  assert.throws(() => checkFreshness([{ field: 'location', checked: '2026-01-01' }], Date.parse('2026-02-02')), /Refresh/);

  const withPhone = makeDemoProspect();
  const phoneFact = { ...withPhone.facts[0], field: 'phone', value: '(214) 555-0142' };
  withPhone.facts.push(phoneFact);
  assert.throws(() => normalizeProspect(withPhone), /evidence excerpt/);
  phoneFact.excerpt = phoneFact.value = '214-555-0142;ext=99';
  assert.throws(() => normalizeProspect(withPhone), /10-digit/);
});

test('service descriptions must be sourced before they can reach an approved preview', async t => {
  const db = await createStore({ url: ':memory:' });
  t.after(() => db.close());
  const input = makeDemoProspect();
  const [service, nameOnly] = input.facts.filter(fact => fact.field === 'service');
  service.description = 'Bring your mileage and service records.';
  assert.throws(() => normalizeProspect(input), /service description must appear/);
  service.excerpt += `\n${service.description}\nInternal evidence note.`;
  const secondDescription = 'Tell us when the vehicle was last serviced.';
  input.facts.push({ ...service }, {
    ...service, description: secondDescription, excerpt: service.value + ' ' + secondDescription,
  });
  const id = await db.save(input);
  await db.release(id, 1);
  const approved = await db.find(id);
  const profile = publicProfile((await db.publicLead(approved.share_token)).data);
  assert.deepEqual(profile.services.filter(row => row.name === service.value), [
    { name: service.value, descriptions: [service.description, secondDescription] },
  ]);
  assert.ok(profile.services.some(row => row.name === nameOnly.value && row.descriptions.length === 0));
  assert.ok(!JSON.stringify(profile).includes('Internal evidence note.'));
});

test('an operator form can carry a full multilingual dossier', async () => {
  const input = makeDemoProspect();
  while (input.facts.length < 16) input.facts.push(input.facts.find(fact => fact.field === 'service'));
  input.facts = input.facts.map(fact => ({
    ...fact, excerpt: fact.value + ' ' + '例'.repeat(1500 - fact.value.length - 1),
  }));
  const body = new URLSearchParams({ action: 'save', prospect: JSON.stringify(input, null, 2) });
  const request = () => new Request('https://example.com/api/agency', { method: 'POST', body });
  await assert.rejects(readForm(request()), /too large/);
  const form = await readForm(request(), 512 * 1024);
  assert.equal(normalizeProspect(JSON.parse(form.get('prospect'))).facts.length, 16);
});

test('approval binds to the reviewed revision and revoking reopens the draft', async t => {
  const db = await createStore({ url: ':memory:' });
  t.after(() => db.close());
  const input = makeDemoProspect();
  const id = await db.save(input);
  const draft = await db.find(id);
  await assert.rejects(db.save(input), /duplicate/);
  await db.save(input, id, draft.revision);
  await assert.rejects(db.release(id, draft.revision), /changed/);
  await db.release(id, draft.revision + 1);
  const approved = await db.find(id);
  assert.ok(await db.publicLead(approved.share_token));
  await assert.rejects(db.save(input, id, approved.revision), /approved/);
  await db.revoke(id);
  assert.ok(!await db.publicLead(approved.share_token));
  await db.release(id, approved.revision + 1);
  assert.notEqual((await db.find(id)).share_token, approved.share_token);
});

test('released and legacy previews keep their terms across an offer change', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sitebefore-offer-change-'));
  const url = 'file:' + join(directory, 'orders.db');
  let db = await createStore({ url });
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const input = makeDemoProspect();
  const oldId = await db.save({ ...input, offer: { amount: 1 } });
  const legacyId = await db.save({ ...input, businessUrl: 'https://example.com/legacy' });
  const newId = await db.save({ ...input, businessUrl: 'https://example.com/next', currency: 'CAD' });
  await db.release(oldId, 1);
  await db.release(legacyId, 1);
  const { share_token: oldToken } = await db.find(oldId);
  const { share_token: legacyToken } = await db.find(legacyId);
  const oldAttempt = (await db.reserveAttempt(oldId, oldToken)).attempt;
  await db.recordSession(oldId, oldAttempt, 'previous-checkout');
  db.close();

  const previousSchema = createClient({ url });
  await previousSchema.execute({
    sql: "UPDATE prospects SET payload = json_remove(payload, '$.offer') WHERE id = ?",
    args: [legacyId],
  });
  previousSchema.close();

  const nextOffer = { amount: 72550, version: 'fixture-v2', scope: ['A different package for this fixture'] };
  db = await createStore({ url }, nextOffer);
  assert.deepEqual((await db.publicLead(oldToken)).offer, currentOffer);
  assert.deepEqual((await db.publicLead(legacyToken)).offer, launchOffer);
  await assert.rejects(db.release(newId, 1, currentOffer.version), /offer changed/);
  await db.release(newId, 1, nextOffer.version);
  const { share_token: newToken, offer } = await db.find(newId);
  assert.deepEqual(offer, nextOffer);

  const oldPayment = {
    id: oldId, attempt: oldAttempt, sessionId: 'previous-checkout', currency: 'USD',
    amount: price, version: offerVersion, provider: 'stripe-test',
  };
  await db.resetFailedSession({ ...oldPayment, version: nextOffer.version });
  assert.equal((await db.publicLead(oldToken)).checkout_id, 'previous-checkout');
  assert.ok(await db.pay(oldPayment));
  assert.ok(await db.pay(oldPayment));
  assert.equal(await db.pay({ ...oldPayment, amount: nextOffer.amount }), false);
  assert.equal(await db.pay({ ...oldPayment, provider: 'demo' }), false);

  const legacyAttempt = (await db.reserveAttempt(legacyId, legacyToken)).attempt;
  assert.ok(await db.pay({
    ...oldPayment, id: legacyId, attempt: legacyAttempt, sessionId: 'legacy-checkout',
    amount: launchOffer.amount, version: launchOffer.version,
  }));

  const started = await db.reserveAttempt(newId, newToken);
  await db.recordSession(newId, started.attempt, 'first-checkout');
  const failed = {
    id: newId, attempt: started.attempt, sessionId: 'first-checkout', currency: 'CAD',
    amount: nextOffer.amount, version: nextOffer.version, provider: 'stripe-test',
  };
  await db.resetFailedSession(failed);
  const retry = await db.publicLead(newToken);
  assert.notEqual(retry.attempt, started.attempt);
  assert.equal(retry.checkout_id, null);
  assert.deepEqual(retry.offer, nextOffer);
  assert.equal(await db.pay(failed), false);
  const newPayment = { ...failed, attempt: retry.attempt, sessionId: 'next-checkout' };
  assert.equal(await db.pay({ ...newPayment, ...currentOffer }), false);
  assert.ok(await db.pay(newPayment));
});

test('duplicate orders converge, stale checkout cannot fulfill, and receipt persists', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sitebefore-test-'));
  const url = 'file:' + join(directory, 'orders.db');
  let db = await createStore({ url });
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const input = makeDemoProspect();
  const id = await db.save(input);
  await db.release(id, 1);
  const { share_token: token } = await db.find(id);
  const [started, retry] = await Promise.all([db.reserveAttempt(id, token), db.reserveAttempt(id, token)]);
  assert.equal(started.attempt, retry.attempt);
  await assert.rejects(db.revoke(id), /checkout attempt/);
  await db.recordSession(id, started.attempt, 'old');
  const current = await db.resetExpiredSession(id, started.attempt, 'old');
  const order = {
    id, attempt: current.attempt, sessionId: 'new', amount: price, currency: 'USD',
    version: offerVersion, provider: 'stripe-test',
  };
  assert.equal(await db.pay({ ...order, attempt: started.attempt, sessionId: 'old' }), false);
  assert.equal(await db.pay({ ...order, amount: 1 }), false);
  assert.equal(await db.pay({ ...order, currency: 'CAD' }), false);
  const siteUrl = 'https://shop.example.com/';
  await assert.rejects(db.markDelivered(id, siteUrl), /paid/);
  assert.deepEqual(await Promise.all([db.pay(order), db.pay(order)]), [true, true]);
  assert.equal(await db.pay({ ...order, sessionId: 'other' }), false);
  await db.recordSession(id, current.attempt, 'new');
  for (const invalid of ['', 'http://shop.example.com/', 'https:shop.example.com',
    'https://operator:secret@shop.example.com/', siteUrl + '?token=test-only', siteUrl + '#fragment']) {
    await assert.rejects(db.markDelivered(id, invalid), /HTTPS/);
  }
  assert.equal((await db.publicLead(token)).delivered_at, null);
  assert.equal((await db.publicLead(token)).site_url, null);
  await Promise.all([db.markDelivered(id, 'https://SHOP.example.com'), db.markDelivered(id, siteUrl)]);
  const { delivered_at: deliveredAt } = await db.publicLead(token);
  await assert.rejects(db.markDelivered(id, 'https://other.example.com/'), /already been recorded/);
  db.close();
  db = await createStore({ url });
  const receipt = await db.publicLead(token);
  assert.equal(receipt.receipt_id, 'new');
  assert.ok(deliveredAt);
  assert.equal(receipt.delivered_at, deliveredAt);
  assert.equal(receipt.site_url, siteUrl);
});

test('an older delivered order can add its published site without changing the receipt date', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sitebefore-legacy-'));
  const url = 'file:' + join(directory, 'orders.db');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = await createStore({ url });
  const id = await db.save(makeDemoProspect());
  await db.release(id, 1);
  const { share_token: token } = await db.find(id);
  const { attempt } = await db.reserveAttempt(id, token);
  assert.ok(await db.pay({
    id, attempt, sessionId: 'legacy-order', amount: price, currency: 'USD',
    version: offerVersion, provider: 'demo',
  }));
  db.close();

  const legacy = createClient({ url });
  const deliveredAt = '2025-01-01T12:00:00.000Z';
  await legacy.batch([
    'DROP TABLE order_deliveries',
    { sql: 'UPDATE orders SET delivered_at = ? WHERE prospect_id = ?', args: [deliveredAt, id] },
  ], 'write');
  legacy.close();

  const upgraded = await createStore({ url });
  t.after(() => upgraded.close());
  const receipt = await upgraded.publicLead(token);
  assert.equal(receipt.delivered_at, deliveredAt);
  assert.equal(receipt.site_url, null);
  await upgraded.markDelivered(id, 'https://shop.example.com/');
  assert.equal((await upgraded.publicLead(token)).delivered_at, deliveredAt);
  assert.equal((await upgraded.publicLead(token)).site_url, 'https://shop.example.com/');
});

test('older paid orders stay visible after 100 new prospects', async t => {
  const db = await createStore({ url: ':memory:' });
  t.after(() => db.close());
  const input = makeDemoProspect();
  const id = await db.save(input);
  await db.release(id, 1);
  const { share_token: token } = await db.find(id);
  const { attempt } = await db.reserveAttempt(id, token);
  for (let index = 0; index < 100; index++) {
    await db.save({ ...input, businessUrl: `https://example.com/prospect/${index}` });
  }
  const firstPage = await db.list();
  assert.equal(firstPage.leads.length, 100);
  assert.equal(firstPage.hasNext, true);
  assert.ok(firstPage.leads.every(lead => !('payload' in lead)));
  assert.ok(await db.pay({
    id, attempt, sessionId: 'old-order', amount: price, currency: 'USD',
    version: offerVersion, provider: 'demo',
  }));
  assert.equal((await db.list()).leads[0].id, id);
  assert.equal((await db.counts()).queued, 1);
  await db.markDelivered(id, 'https://shop.example.com/');
  const history = await db.list(2);
  assert.equal(history.leads[0].id, id);
  assert.ok(history.leads[0].delivered_at);
  assert.equal(history.hasNext, false);
  assert.equal((await db.counts()).delivered, 1);
});

test('only signed, paid Stripe sandbox events can become order candidates', () => {
  const oldKey = process.env.STRIPE_SECRET_KEY;
  const oldWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
    for (const prefix of ['sk', 'rk', 'rkcs']) {
      process.env.STRIPE_SECRET_KEY = prefix + '_live_fixture';
      assert.equal(checkoutMode(), null);
      process.env.STRIPE_SECRET_KEY = prefix + '_test_fixture';
      assert.equal(checkoutMode(), 'stripe-test');
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = {
      id: 'cs_test_fixture', livemode: false, mode: 'payment', currency: 'usd', amount_total: price,
      payment_status: 'paid', metadata: { prospect_id: 'lead', attempt: 'one', offer_version: offerVersion },
    };
    const event = { type: 'checkout.session.completed', livemode: false, data: { object: session } };
    const body = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET });
    assert.equal(paymentFromEvent(verifyWebhook(body, header)).sessionId, session.id);
    assert.throws(() => verifyWebhook(body + ' ', header), /signature/);
    assert.equal(paymentFromEvent({ ...event, livemode: true }), null);
    assert.equal(paymentFromEvent({ ...event, data: { object: { ...session, payment_status: 'unpaid' } } }), null);
    assert.ok(paymentFromEvent({ ...event, type: 'checkout.session.async_payment_succeeded' }));
    const failed = { ...event, type: 'checkout.session.async_payment_failed',
      data: { object: { ...session, payment_status: 'unpaid' } } };
    assert.deepEqual(failureFromEvent(failed), paymentFromEvent(event));
    assert.equal(failureFromEvent({ ...failed, livemode: true }), null);
  } finally {
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldKey;
    if (oldWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = oldWebhook;
  }
});
