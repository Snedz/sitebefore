import Stripe from 'stripe';
import { checkoutModeForOffer } from './offer.mjs';
import { WorkflowError } from './prospect.mjs';

export function checkoutMode() {
  if (import.meta.env?.DEV && process.env.SITEBEFORE_DEMO_CHECKOUT === '1' &&
      !process.env.SITEBEFORE_DB_URL) return 'demo';
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  const webhook = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (/^(sk|rk|rkcs)_test_/.test(key) && webhook.startsWith('whsec_')) return 'stripe-test';
  return null;
}
const stripeClient = () => new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });

export function checkoutOrigin(value = process.env.SITEBEFORE_ORIGIN, dev = import.meta.env?.DEV) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.protocol === 'https:' || (dev && url.protocol === 'http:') ? url.origin : null;
  } catch {
    return null;
  }
}

export function stripeCheckoutParams(lead, path, origin) {
  const mode = checkoutModeForOffer(lead.offer);
  return {
    mode,
    integration_identifier: 'sitebefore-checkout-jmfxcrtv',
    adaptive_pricing: { enabled: false },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: lead.data.currency.toLowerCase(),
        unit_amount: lead.offer.amount,
        ...(mode === 'subscription' ? { recurring: { interval: lead.offer.interval } } : {}),
        product_data: { name: 'SiteBefore launch package' },
      },
    }],
    success_url: origin + path + '?checkout=returned#offer',
    cancel_url: origin + path + '?checkout=cancelled#offer',
    metadata: { prospect_id: lead.id, attempt: lead.attempt, offer_version: lead.offer.version },
  };
}

export async function startStripeCheckout(store, lead, path, origin) {
  const stripe = stripeClient();
  if (lead.checkout_id) {
    const existing = await stripe.checkout.sessions.retrieve(lead.checkout_id);
    if (existing.status === 'open' && existing.url) return existing.url;
    if (existing.status !== 'expired') return path + '?checkout=returned#offer';
    lead = await store.resetExpiredSession(lead.id, lead.attempt, existing.id);
    if (lead.paid_at || lead.checkout_id) return path + '?checkout=returned#offer';
  }
  const session = await stripe.checkout.sessions.create(stripeCheckoutParams(lead, path, origin), {
    idempotencyKey: 'sitebefore:' + lead.attempt,
  });
  if (!session.url || session.livemode) throw new WorkflowError('Test checkout is unavailable.', 502);
  await store.recordSession(lead.id, lead.attempt, session.id);
  return session.url;
}

function checkoutFromEvent(event, paymentStatus) {
  const session = event.data?.object;
  const meta = session?.metadata;
  const currency = session?.currency?.toUpperCase();
  if (event.livemode !== false || session?.livemode !== false || !['payment', 'subscription'].includes(session.mode) ||
      session.payment_status !== paymentStatus ||
      !session.id?.startsWith('cs_test_') || !meta?.prospect_id || !meta?.attempt ||
      !meta.offer_version || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 ||
      !['USD', 'CAD'].includes(currency)) return null;
  const subscription = session.mode === 'subscription' ? session.subscription : null;
  const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id;
  return {
    id: meta.prospect_id, attempt: meta.attempt, sessionId: session.id,
    amount: session.amount_total, currency,
    version: meta.offer_version, provider: 'stripe-test', mode: session.mode,
    ...(typeof subscriptionId === 'string' && subscriptionId.startsWith('sub_') ? { subscriptionId } : {}),
  };
}

export function paymentFromEvent(event) {
  return ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)
    ? checkoutFromEvent(event, 'paid') : null;
}

export function failureFromEvent(event) {
  return event.type === 'checkout.session.async_payment_failed' ? checkoutFromEvent(event, 'unpaid') : null;
}

export function verifyWebhook(body, signature) {
  if (!signature) throw new WorkflowError('Invalid Stripe signature.', 400);
  try {
    return stripeClient().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new WorkflowError('Invalid Stripe signature.', 400);
  }
}
