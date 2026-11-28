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

  async function request(path, status, { form, cookie } = {}) {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, 'The simulation stays on the local pilot server');
    const headers = cookie ? { cookie } : {};
    if (form) headers.origin = origin;
    const response = await fetch(url, {
      headers,
      body: form ? new URLSearchParams(form) : undefined,
      method: form ? 'POST' : 'GET',
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

  const paidWorkspace = await request(seeded.location, 200, { cookie });
  assert.match(paidWorkspace.html, /Revoke share link/);
  assert.match(paidWorkspace.html, /No unmatched Stripe payments/);
  await request('/api/agency', 409, { cookie, form: { action: 'revoke', id } });
  await agency({ action: 'revoke', id, revision: '2' });
  const revoked = await request(previewPath, 410);
  assert.doesNotMatch(revoked.html, phoneLink);
  const receiptPath = revoked.html.match(/href="([^"]+\?receipt=1)"/)?.[1];
  assert.ok(receiptPath);
  const receiptOnly = await request(receiptPath, 200);
  assert.match(receiptOnly.headers.get('x-robots-tag') ?? '', /noindex/);
  assert.match(receiptOnly.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(receiptOnly.html.match(receiptReference)?.[1], reference);
  assert.ok(receiptOnly.html.includes(`href="${site}"`));
  assert.doesNotMatch(receiptOnly.html, phoneLink);
  assert.doesNotMatch(receiptOnly.html, /\/api\/checkout/);
  await request('/api/checkout', 404, { form: { token } });
  const revokedWorkspace = await request(seeded.location, 200, { cookie });
  assert.match(revokedWorkspace.html, /Order marked delivered/);
  assert.ok(revokedWorkspace.html.includes(reference));

  process.env.SITEBEFORE_DEMO_CHECKOUT = '0';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sessionId = 'cs_test_revoked_preview';
  const payload = JSON.stringify({
    type: 'checkout.session.completed', livemode: false,
    data: { object: {
      id: sessionId, livemode: false, mode: 'payment', currency: 'usd',
      amount_total: currentOffer.amount, payment_status: 'paid',
      metadata: { prospect_id: id, attempt: 'stale-attempt', offer_version: currentOffer.version },
    } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const webhook = headers => fetch(origin + '/api/stripe-webhook', {
    method: 'POST', body: payload, headers, signal: AbortSignal.timeout(5_000),
  });
  assert.equal((await webhook({})).status, 400);
  assert.match((await request(seeded.location, 200, { cookie })).html, /No unmatched Stripe payments/);
  assert.equal((await webhook({ 'stripe-signature': signature })).status, 204);
  assert.equal((await webhook({ 'stripe-signature': signature })).status, 204);
  const flagged = await request(seeded.location, 200, { cookie });
  assert.match(flagged.html, /Payments needing reconciliation/);
  assert.match(flagged.html, /Checkout attempt is no longer current/);
  assert.equal(flagged.html.split(sessionId).length, 2);
  assert.doesNotMatch((await request(seeded.location, 200)).html, /Payments needing reconciliation/);
});
