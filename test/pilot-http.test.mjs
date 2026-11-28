import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { makeDemoProspect } from '../src/data/demo-prospect.mjs';
import { currentOffer, displayPrice } from '../src/lib/offer.mjs';

test('a fictional buyer can pay for an approved preview and receive the launch link', { timeout: 30_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(join(tmpdir(), 'sitebefore-pilot-'));
  const originalCwd = process.cwd();
  const key = randomBytes(32).toString('hex');
  const reviewerKey = randomBytes(32).toString('hex');
  const settings = {
    ASTRO_DISABLE_UPDATE_CHECK: 'true',
    ASTRO_TELEMETRY_DISABLED: '1',
    SITEBEFORE_DEMO_CHECKOUT: '1',
    SITEBEFORE_OPERATOR_KEY: key,
    SITEBEFORE_OPERATORS: 'reviewer:' + reviewerKey,
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
  assert.match(cookie, /^sitebefore_operator=[A-Za-z0-9_-]{43}$/);
  assert.match(signIn.headers.get('set-cookie'), /Max-Age=3600/i);
  assert.match(signIn.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(signIn.headers.get('set-cookie'), /SameSite=Strict/i);
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
  const namedSignIn = await request('/api/agency', 303, { form: { action: 'sign-in', operator: 'reviewer', key: reviewerKey } });
  const namedCookie = namedSignIn.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(namedCookie);
  assert.notEqual(namedCookie, cookie);
  const review = form => request('/api/agency', 303, { form, cookie: namedCookie });
  assert.match((await request(seeded.location, 200, { cookie: namedCookie })).html, /Approved by operator/);
  await review({ action: 'revoke', id });
  assert.doesNotMatch((await request(seeded.location, 200, { cookie: namedCookie })).html, /Approved by operator/);
  await review({ action: 'release', id, revision: '3', verified: 'yes', offer_version: currentOffer.version });
  const approved = await request(seeded.location, 200, { cookie });
  assert.match(approved.html, /Approved by reviewer/);
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
  assert.doesNotMatch(delivered.html, /Recent operator activity|Approved by reviewer/);

  await review({ action: 'delivered', id, site_url: site });
  await request('/api/agency', 409, { cookie, form: { action: 'revoke', id } });
  await review({ action: 'sign-out' });
  await request(draftPath, 401, { cookie: namedCookie });
  const afterLogout = await request(seeded.location, 200, { cookie });
  assert.match(afterLogout.html, /Recent operator activity/);
  const rows = [...afterLogout.html.matchAll(/<strong\b[^>]*>(operator|reviewer)<\/strong>\s*·\s*(Signed in|Signed out|Saved draft|Approved and released preview|Revoked preview|Marked order delivered)/g)]
    .map(([, actor, action]) => [actor, action]);
  assert.deepEqual(rows, [
    ['reviewer', 'Signed out'], ['operator', 'Marked order delivered'], ['reviewer', 'Approved and released preview'],
    ['reviewer', 'Revoked preview'], ['reviewer', 'Signed in'], ['operator', 'Approved and released preview'],
    ['operator', 'Saved draft'], ['operator', 'Saved draft'], ['operator', 'Signed in'],
  ]);

  const newCookie = async newKey => (await request('/api/agency', 303, { form: {
    action: 'sign-in', operator: 'reviewer', key: newKey,
  } })).headers.get('set-cookie').split(';', 1)[0];
  const beforeRotation = await newCookie(reviewerKey);
  const rotatedKey = randomBytes(32).toString('hex');
  process.env.SITEBEFORE_OPERATORS = 'reviewer:' + rotatedKey;
  await request(draftPath, 401, { cookie: beforeRotation });
  await request(draftPath, 200, { cookie });
  const afterRotation = await newCookie(rotatedKey);
  await request(draftPath, 200, { cookie: afterRotation });
  delete process.env.SITEBEFORE_OPERATORS;
  await request(draftPath, 401, { cookie: afterRotation });
  await request(draftPath, 200, { cookie });
});
