import { checkoutMode, checkoutOrigin, startStripeCheckout } from '../../lib/checkout.mjs';
import { readForm, fail, sameOrigin, privateRedirect } from '../../lib/http.mjs';
import { getStore, simulatedSession } from '../../lib/store.mjs';
import { WorkflowError } from '../../lib/prospect.mjs';
import { offerVersion, price } from '../../lib/offer.mjs';
export const prerender = false;

export async function POST({ request, url }) {
  try {
    sameOrigin(request);
    const mode = checkoutMode();
    if (!mode) throw new WorkflowError('Test checkout is unavailable.', 503);
    const origin = checkoutOrigin();
    if (mode === 'stripe-test' && origin !== url.origin) {
      throw new WorkflowError('Checkout is unavailable on this hostname.', 503);
    }
    const form = await readForm(request);
    const token = form.get('token') ?? '';
    const store = await getStore();
    let lead = await store.publicLead(token);
    if (!lead) throw new WorkflowError('Preview not found.', 404);
    const path = '/p/' + token + '/';
    if (lead.paid_at) return privateRedirect(path + '#offer');
    lead = await store.reserveAttempt(lead.id, token);
    if (lead.paid_at) return privateRedirect(path + '#offer');
    if (mode === 'demo') {
      if (form.get('action') !== 'simulate') return privateRedirect(path + '?checkout=demo#offer');
      const sessionId = simulatedSession(lead.id, lead.attempt);
      await store.recordSession(lead.id, lead.attempt, sessionId);
      if (!await store.pay({
        id: lead.id, attempt: lead.attempt, sessionId, amount: price, currency: lead.data.currency,
        version: offerVersion, provider: 'demo',
      })) throw new WorkflowError('Could not record the simulated order.', 409);
      return privateRedirect(path + '#offer');
    }
    return privateRedirect(await startStripeCheckout(store, lead, path, origin));
  } catch (err) {
    return fail(err);
  }
}
