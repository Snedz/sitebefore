import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Stripe from 'stripe';
import { makeDemoProspect } from '../src/data/demo-prospect.mjs';
import { currentOffer, displayPrice } from '../src/lib/offer.mjs';
import { createStore } from '../src/lib/store.mjs';

test('a fictional buyer can pay for an approved preview and receive the launch link', { timeout: 30_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(join(tmpdir(), 'sitebefore-pilot-'));
  const originalCwd = process.cwd();
  const key = randomBytes(32).toString('hex');
  const settings = {
    ASTRO_DISABLE_UPDATE_CHECK: 'true',
    ASTRO_TELEMETRY_DISABLED: '1',
    SITEBEFORE_DEMO_CHECKOUT: '1',
    SITEBEFORE_OPERATOR_KEY: key,
    SITEBEFORE_DB_URL: undefined,
    SITEBEFORE_DB_TOKEN: undefined,
    SITEBEFORE_ORIGIN: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    RESEND_API_KEY: undefined,
    SITEBEFORE_EMAIL_FROM: undefined,
    VERCEL: undefined,
  };
  const originalSettings = Object.keys(settings).map(name => [name, process.env[name]]);
  let server;
  t.after(async () => {
    try {
      await server?.stop();
    } finally {
      process.chdir(originalCwd);
      for (const [name, value] of originalSettings) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  for (const name of ['astro.config.mjs', 'package.json', 'public', 'src']) {
    cpSync(join(root, name), join(scratch, name), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'junction');
  for (const [name, value] of Object.entries(settings)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  process.chdir(scratch);
  const { dev } = await import('astro');
  server = await dev({ root: scratch, server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' });
  const origin = `http://127.0.0.1:${server.address.port}`;

  async function request(path, status, { form, cookie, body, signature } = {}) {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, 'The simulation stays on the local pilot server');
    const headers = cookie ? { cookie } : {};
    if (form) headers.origin = origin;
    if (signature) headers['stripe-signature'] = signature;
    const response = await fetch(url, {
      headers,
      body: form ? new URLSearchParams(form) : body,
      method: form || body ? 'POST' : 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
    const html = await response.text();
    assert.equal(response.status, status, `Expected HTTP ${status} for ${path.split(/[/?]/)[1]}`);
    return { html, headers: response.headers, location: response.headers.get('location') };
  }

  const signIn = await request('/api/agency', 303, { form: { action: 'sign-in', key } });
  const cookie = signIn.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'Agency OS sets an operator session');
  const agency = form => request('/api/agency', 303, { form, cookie });
  const seeded = await agency({ action: 'seed' });
  const id = new URL(seeded.location, origin).searchParams.get('lead');
  assert.ok(id);
  const draftPath = '/agency/draft/' + id + '/';
  const originalDraft = await request(draftPath, 200, { cookie });
  assert.doesNotMatch(originalDraft.html, /href="tel:/);
  const dossier = makeDemoProspect();
  const phone = '(214)\u00A0555\u20110142';
  const phoneLink = /href="tel:\+12145550142"/;
  const privateNote = 'Fixture phone evidence for operator review.';
  dossier.facts.push({
    field: 'phone', value: phone, excerpt: phone + ' ' + privateNote,
    source: dossier.businessUrl, checked: dossier.facts[0].checked,
  });
  await agency({ action: 'save', id, revision: '1', prospect: JSON.stringify(dossier) });
  const draft = await request(draftPath, 200, { cookie });
  assert.match(draft.html, phoneLink);
  assert.ok(!draft.html.includes(privateNote));
  await agency({ action: 'release', id, revision: '2', verified: 'yes', offer_version: currentOffer.version });
  const approved = await request(seeded.location, 200, { cookie });
  const previewPath = approved.html.match(/\/p\/[A-Za-z0-9_-]{32}\//)?.[0];
  assert.ok(previewPath, 'Agency OS shows the approved buyer link');
  const token = previewPath.split('/')[2];
  const preview = await request(previewPath, 200);
  assert.match(preview.headers.get('x-robots-tag') ?? '', /noindex/);
  assert.ok(preview.html.includes(displayPrice('USD')));
  assert.ok(preview.html.includes(currentOffer.scope[0]));
  assert.match(preview.html, /Start test checkout/);
  assert.match(preview.html, phoneLink);
  assert.match(preview.html, /Call the business/);
  assert.ok(!preview.html.includes(privateNote));

  const checkout = form => request('/api/checkout', 303, { form: { token, ...form } });
  const started = await checkout();
  const simulation = await request(started.location, 200);
  assert.match(simulation.html, /Simulate test payment/);
  assert.doesNotMatch(simulation.html, /Simulated payment received/);
  const cancelled = await request(previewPath + '?checkout=cancelled', 200);
  assert.match(cancelled.html, /Resume test checkout/);
  await checkout();
  await checkout({ action: 'simulate' });
  const receipt = await request(previewPath, 200);
  const receiptReference = /Order reference\s*<code\b[^>]*>([^<]+)<\/code>/;
  assert.match(receipt.html, /Simulated payment received/);
  const reference = receipt.html.match(receiptReference)?.[1];
  assert.ok(reference, 'Payment creates a buyer receipt');
  assert.doesNotMatch(receipt.html, /Open your published site/);

  await checkout({ action: 'simulate' });
  const site = 'https://example.com/fictional-launch/';
  await agency({ action: 'delivered', id, site_url: site });
  const delivered = await request(previewPath, 200);
  assert.match(delivered.html, /marked this order delivered/);
  assert.ok(delivered.html.includes(`href="${site}"`));
  assert.equal(delivered.html.match(receiptReference)?.[1], reference);
  assert.match((await request(seeded.location, 200, { cookie })).html, /Receipt email: Skipped for simulation/);

  await t.test('signed Stripe orders record one receipt and delivery email outcome per kind', async t => {
    delete process.env.SITEBEFORE_DEMO_CHECKOUT;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
    process.env.SITEBEFORE_ORIGIN = origin;
    process.env.RESEND_API_KEY = 'fixture-resend-key';
    process.env.SITEBEFORE_EMAIL_FROM = 'SiteBefore <receipts@test-mail.example.com>';
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const db = await createStore({ url: 'file:' + join(scratch, '.local/sitebefore.db') });
    t.after(() => db.close());
    const calls = [];
    let providerError = false;
    const localFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (new URL(url).origin === origin) return localFetch(url, options);
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer fixture-resend-key');
      calls.push({ ...JSON.parse(options.body), idempotencyKey: options.headers['Idempotency-Key'] });
      if (providerError && calls.at(-1).idempotencyKey.endsWith('/delivery')) throw new Error('Fixture network error');
      return new Response(null, { status: providerError ? 503 : 200 });
    });

    const buyer = 'customer@example.com';
    async function fixture(label) {
      const dossier = makeDemoProspect();
      dossier.businessUrl = 'https://example.com/' + label;
      const name = dossier.facts.find(fact => fact.field === 'name');
      name.value = name.excerpt = 'Fixture & <Shop>';
      const id = await db.save(dossier);
      await db.release(id, 1);
      const path = '/p/' + (await db.find(id)).share_token + '/';
      const { attempt } = await db.reserveAttempt(id, path.split('/')[2]);
      const reference = 'cs_test_' + label;
      await db.recordSession(id, attempt, reference);
      const session = { id: reference, livemode: false, mode: 'payment', payment_status: 'paid',
        currency: 'usd', amount_total: currentOffer.amount, customer_details: { email: buyer },
        metadata: { prospect_id: id, attempt, offer_version: currentOffer.version } };
      const webhook = async ({ status = 204, signed = true, changes = {} } = {}) => {
        const body = JSON.stringify({ type: 'checkout.session.completed', livemode: false,
          data: { object: { ...session, ...changes } } });
        const signature = signed ? stripe.webhooks.generateTestHeaderString({
          payload: body, secret: process.env.STRIPE_WEBHOOK_SECRET,
        }) : 'invalid';
        return request('/api/stripe-webhook', status, { body, signature });
      };
      return { id, path, reference, webhook, deliver: () => agency({ action: 'delivered', id, site_url: site }),
        workspace: () => request('/agency/?lead=' + id, 200, { cookie }) };
    }

    const paid = await fixture('email_success');
    await paid.webhook({ signed: false, status: 400 });
    await paid.webhook({ status: 422, changes: { amount_total: 100 } });
    assert.equal(calls.length, 0);
    assert.equal(await db.buyerEmail(paid.id), undefined);
    await Promise.all([paid.webhook(), paid.webhook()]);
    assert.equal(calls.length, 1);
    await paid.webhook({ changes: { customer_details: { email: 'other@example.com' } } });
    assert.equal(await db.buyerEmail(paid.id), buyer);
    assert.equal(calls.length, 1);
    const receiptMail = calls[0];
    assert.deepEqual(receiptMail.to, [buyer]);
    assert.equal(receiptMail.from, process.env.SITEBEFORE_EMAIL_FROM);
    for (const copy of ['Fixture & <Shop>', displayPrice('USD'), paid.reference, origin + paid.path, ...currentOffer.scope]) {
      assert.ok(receiptMail.text.includes(copy), copy);
    }
    assert.ok(receiptMail.html.includes('Fixture &amp; &lt;Shop&gt;'));
    assert.ok(receiptMail.html.includes(`href="${origin + paid.path}"`));
    assert.doesNotMatch(receiptMail.html, /<img\b/);
    await paid.deliver();
    await paid.deliver();
    assert.equal(calls.length, 2);
    assert.ok(calls[1].text.includes(site));
    assert.ok(calls[1].html.includes(`href="${site}"`));
    assert.notEqual(calls[1].idempotencyKey, receiptMail.idempotencyKey);
    const buyerPage = await request(paid.path, 200);
    assert.equal(buyerPage.html.match(receiptReference)?.[1], paid.reference);
    assert.ok(!buyerPage.html.includes(buyer));
    const paidWorkspace = await paid.workspace();
    assert.match(paidWorkspace.html, /Receipt email: Sent/);
    assert.match(paidWorkspace.html, /Delivery email: Sent/);

    delete process.env.RESEND_API_KEY;
    const skipped = await fixture('email_unconfigured');
    await skipped.webhook();
    await skipped.deliver();
    assert.equal(await db.buyerEmail(skipped.id), buyer);
    assert.deepEqual(await db.orderEmailStatuses(skipped.id), { receipt: 'not_configured', delivery: 'not_configured' });
    assert.match((await skipped.workspace()).html, /Receipt email: Not sent \(email not configured\)/);
    assert.equal(calls.length, 2);

    process.env.RESEND_API_KEY = 'fixture-resend-key';
    const noAddress = await fixture('email_missing');
    await noAddress.webhook({ changes: { customer_details: {} } });
    assert.deepEqual(await db.orderEmailStatuses(noAddress.id), { receipt: 'no_address' });
    assert.equal(calls.length, 2);

    providerError = true;
    const failed = await fixture('email_failed');
    await failed.webhook();
    await failed.webhook();
    await failed.deliver();
    await failed.deliver();
    assert.equal(calls.length, 4);
    assert.deepEqual(await db.orderEmailStatuses(failed.id), { receipt: 'failed', delivery: 'failed' });
    assert.match((await failed.workspace()).html, /Delivery email: Failed/);
    const order = await db.find(failed.id);
    assert.equal(order.receipt_id, failed.reference);
    assert.ok(order.paid_at);
    assert.ok(order.delivered_at);
    assert.equal(order.site_url, site);
  });
});
