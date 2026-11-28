import { checkoutOrigin } from './checkout.mjs';
import { displayPrice } from './offer.mjs';
import { prospectSummary } from './store.mjs';

const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = value => value.replace(/[&<>"']/g, char => htmlEntities[char]);
const linesAsHtml = lines => lines.map(line => `<p>${escape(line)}</p>`).join('');

function messageFor(lead, kind) {
  const name = prospectSummary(lead).name;
  const reference = 'Order reference: ' + lead.receipt_id;
  if (kind === 'delivery') {
    if (!lead.site_url) return null;
    return { subject: 'Your SiteBefore website is ready',
      lines: [`The website for ${name} is ready.`, reference], link: lead.site_url, linkText: 'Open your published site' };
  }
  const origin = checkoutOrigin();
  if (!origin || !lead.share_token) return null;
  return {
    subject: 'Your SiteBefore receipt',
    lines: [`Payment confirmed for ${name}.`, `Approved offer: ${displayPrice(lead.data.currency, lead.offer.amount)} one-time.`,
      ...lead.offer.scope, reference],
    link: new URL('/p/' + lead.share_token + '/', origin).href,
    linkText: 'Open your receipt',
  };
}

async function send(store, id, kind) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SITEBEFORE_EMAIL_FROM?.trim();
  if (!key || !from) return 'not_configured';
  const email = await store.buyerEmail(id);
  if (!email) return 'no_address';
  const message = messageFor(await store.find(id), kind);
  if (!message) return 'no_link';
  const { subject, lines, link, linkText } = message;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      'Idempotency-Key': `sitebefore/${id}/${kind}` },
    body: JSON.stringify({ from, to: [email], subject,
      text: [...lines, `${linkText}: ${link}`].join('\n\n'),
      html: linesAsHtml(lines) + `<p><a href="${escape(link)}">${escape(linkText)}</a></p>` }),
    signal: AbortSignal.timeout(5000),
  });
  return response.ok ? 'sent' : 'failed';
}

export async function sendOrderEmail(store, id, kind) {
  try {
    if (!await store.claimOrderEmail(id, kind)) return;
    let status;
    try {
      status = await send(store, id, kind);
    } catch {
      status = 'failed';
    }
    await store.finishOrderEmail(id, kind, status);
  } catch {
    console.error('SiteBefore could not record the order email status.');
  }
}
