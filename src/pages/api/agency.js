import { fail, isOperator, logIn, logOut, readForm, sameOrigin, privateHeaders, privateRedirect } from '../../lib/http.mjs';
import { getStore } from '../../lib/store.mjs';
import { WorkflowError } from '../../lib/prospect.mjs';
import { makeDemoProspect } from '../../data/demo-prospect.mjs';
import { checkoutMode } from '../../lib/checkout.mjs';

export const prerender = false;
export async function POST({ request, cookies }) {
  let id;
  try {
    sameOrigin(request);
    const form = await readForm(request);
    const action = form.get('action');
    id = form.get('id');
    if (action === 'sign-in') {
      logIn(cookies, form.get('key') ?? '', request.url);
      return privateRedirect('/agency/');
    }
    if (!isOperator(cookies)) throw new WorkflowError('Sign in to use Agency OS.', 401);
    if (action === 'sign-out') {
      logOut(cookies);
      return privateRedirect('/agency/');
    }
    if (id && !/^[0-9a-f-]{36}$/.test(id)) throw new WorkflowError('Invalid prospect.', 404);
    const store = await getStore();
    const revision = Number(form.get('revision'));
    switch (action) {
      case 'seed':
        if (checkoutMode() !== 'demo') throw new WorkflowError('Demo mode is disabled.', 404);
        id = await store.save(makeDemoProspect());
        break;
      case 'save': {
        let input;
        try { input = JSON.parse(form.get('prospect') ?? ''); }
        catch { throw new WorkflowError('The prospect dossier must be valid JSON.'); }
        id = await store.save(input, id, revision);
        break;
      }
      case 'release':
        if (form.get('verified') !== 'yes') throw new WorkflowError('Confirm you checked the facts and design before release.');
        await store.release(id, revision);
        break;
      case 'revoke': await store.revoke(id); break;
      case 'delivered': await store.markDelivered(id); break;
      default: throw new WorkflowError('Unknown action.');
    }
    return privateRedirect('/agency/' + (id ? '?lead=' + id : ''));
  } catch (err) {
    if (err instanceof WorkflowError && err.status === 401) return privateRedirect('/agency/?notice=signin');
    if (err instanceof WorkflowError && err.status < 500 && isOperator(cookies)) {
      return new Response(err.message + '\nUse your browser’s Back button to return to the form.', {
        status: err.status, headers: { ...privateHeaders, 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return fail(err);
  }
}
