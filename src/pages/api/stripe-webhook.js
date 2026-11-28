import { checkoutMode, failureFromEvent, paymentFromEvent, verifyWebhook } from '../../lib/checkout.mjs';
import { fail, readBody } from '../../lib/http.mjs';
import { getStore } from '../../lib/store.mjs';
import { sendOrderEmail } from '../../lib/receipt-email.mjs';
import { WorkflowError } from '../../lib/prospect.mjs';
export const prerender = false;

export async function POST({ request }) {
  try {
    if (checkoutMode() !== 'stripe-test') throw new WorkflowError('Test checkout is unavailable.', 503);
    const event = verifyWebhook(await readBody(request, 262144), request.headers.get('stripe-signature'));
    const payment = paymentFromEvent(event);
    if (payment) {
      const store = await getStore();
      if (!await store.pay(payment)) throw new WorkflowError('Session did not match a SiteBefore order.', 422);
      await sendOrderEmail(store, payment.id, 'receipt');
    }
    const failed = failureFromEvent(event);
    if (failed) await (await getStore()).resetFailedSession(failed);
    return new Response(null, { status: 204 });
  } catch (err) {
    return fail(err);
  }
}
