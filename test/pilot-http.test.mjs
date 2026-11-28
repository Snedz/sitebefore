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
  assert.doesNotMatch(originalDraft.html, /<details name="dossier-services"/);
  const dossier = makeDemoProspect();
  dossier.facts = dossier.facts.filter(fact => fact.field !== 'story');
  const service = dossier.facts.find(fact => fact.field === 'service');
  service.description = 'Inspect belts, hoses, fluids, and filters.';
  service.excerpt += ' ' + service.description;
  const phone = '(214)\u00A0555\u20110142';
  const phoneLink = /href="tel:\+12145550142"/;
  const privateNote = 'Fixture phone evidence for operator review.';
  dossier.facts.push({
    field: 'phone', value: phone, excerpt: phone + ' ' + privateNote,
    source: dossier.businessUrl, checked: dossier.facts[0].checked,
  });
  await agency({ action: 'save', id, revision: '1', prospect: JSON.stringify(dossier) });
  const draft = await request(draftPath, 200, { cookie });
  assert.match(draft.headers.get('x-robots-tag') ?? '', /noindex/);
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
  for (const page of [draft, preview]) {
    assert.match(page.html, /Private preview · Unaffiliated/);
    assert.match(page.html, /<details name="dossier-services"[^>]*>\s*<summary[^>]*>Maintenance<\/summary>/);
    assert.ok(page.html.includes(service.description));
    assert.match(page.html, /<p class="service-name"[^>]*>Diagnostics<\/p>/);
    assert.doesNotMatch(page.html, /id="workshop"|<img\b|juniper-(hero|craft)/);
  }

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
});
