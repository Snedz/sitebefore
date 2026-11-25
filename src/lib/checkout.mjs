import Stripe from 'stripe';
import { offerVersion, price } from './offer.mjs';
import { WorkflowError } from './prospect.mjs';

export function checkoutMode() {
  if (import.meta.env?.DEV && process.env.SITEBEFORE_DEMO_CHECKOUT === '1' &&
      !process.env.SITEBEFORE_DB_URL) return 'demo';
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  const webhook = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (/^(sk|rk)_test_/.test(key) && webhook.startsWith('whsec_')) return 'stripe-test';
  return null;
}
const stripeClient = () => new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });

export async function startStripeCheckout(store, lead, path, origin) {
  const stripe = stripeClient();
  if (lead.checkout_id) {
    const existing = await stripe.checkout.sessions.retrieve(lead.checkout_id);
    if (existing.status === 'open' && existing.url) return existing.url;
    if (existing.status !== 'expired') return path + '?checkout=returned#offer';
    lead = await store.resetExpiredSession(lead.id, lead.attempt, existing.id);
    if (lead.paid_at || lead.checkout_id) return path + '?checkout=returned#offer';
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    integration_identifier: 'sitebefore-checkout-jmfxcrtv',
    adaptive_pricing: { enabled: false },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: lead.data.currency.toLowerCase(),
        unit_amount: price,
        product_data: { name: 'SiteBefore launch package' },
      },
    }],
    success_url: origin + path + '?checkout=returned#offer',
    cancel_url: origin + path + '?checkout=cancelled#offer',
    metadata: { prospect_id: lead.id, attempt: lead.attempt, offer_version: offerVersion },
  }, { idempotencyKey: 'sitebefore:' + lead.attempt });
  if (!session.url || session.livemode) throw new WorkflowError('Test checkout is unavailable.', 502);
  await store.recordSession(lead.id, lead.attempt, session.id);
  return session.url;
}

export function paymentFromEvent(event) {
  if (event.livemode !== false || !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    return null;
  }
  const session = event.data.object;
  const meta = session.metadata;
  if (session.livemode !== false || session.mode !== 'payment' || session.payment_status !== 'paid' ||
      !session.id?.startsWith('cs_test_') || !meta?.prospect_id || !meta?.attempt ||
      meta.offer_version !== offerVersion) return null;
  return {
    id: meta.prospect_id, attempt: meta.attempt, sessionId: session.id,
    amount: session.amount_total, currency: session.currency?.toUpperCase(),
    version: meta.offer_version, provider: 'stripe-test',
  };
}

export function failureFromEvent(event) {
  if (event.livemode !== false || event.type !== 'checkout.session.async_payment_failed') return null;
  const session = event.data.object;
  const meta = session.metadata;
  if (session.livemode !== false || session.mode !== 'payment' || session.payment_status !== 'unpaid' ||
      !session.id?.startsWith('cs_test_') || !meta?.prospect_id || !meta?.attempt ||
      meta.offer_version !== offerVersion || session.amount_total !== price) return null;
  return { id: meta.prospect_id, attempt: meta.attempt, sessionId: session.id };
}

export function verifyWebhook(body, signature) {
  if (!signature) throw new WorkflowError('Invalid Stripe signature.', 400);
  try {
    return stripeClient().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new WorkflowError('Invalid Stripe signature.', 400);
  }
}
