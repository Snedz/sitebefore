import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Stripe from 'stripe';
import { createStore } from '../src/lib/store.mjs';
import { makeDemoProspect } from '../src/data/demo-prospect.mjs';
import { normalizeProspect, checkFreshness, publicProfile } from '../src/lib/prospect.mjs';
import { offerVersion, price } from '../src/lib/offer.mjs';
import { failureFromEvent, paymentFromEvent, verifyWebhook } from '../src/lib/checkout.mjs';

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
  await assert.rejects(db.markDelivered(id), /paid/);
  assert.deepEqual(await Promise.all([db.pay(order), db.pay(order)]), [true, true]);
  assert.equal(await db.pay({ ...order, sessionId: 'other' }), false);
  await db.recordSession(id, current.attempt, 'new');
  await db.markDelivered(id);
  db.close();
  db = await createStore({ url });
  const receipt = await db.publicLead(token);
  assert.equal(receipt.receipt_id, 'new');
  assert.ok(receipt.delivered_at);
});

test('only signed, paid Stripe sandbox events can become order candidates', () => {
  const oldKey = process.env.STRIPE_SECRET_KEY;
  const oldWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
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
    assert.deepEqual(failureFromEvent(failed), { id: 'lead', attempt: 'one', sessionId: session.id });
    assert.equal(failureFromEvent({ ...failed, livemode: true }), null);
  } finally {
    if (oldKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldKey;
    if (oldWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = oldWebhook;
  }
});
