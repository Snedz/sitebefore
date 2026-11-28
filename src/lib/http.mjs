import { createHmac, timingSafeEqual } from 'node:crypto';
import { WorkflowError } from './prospect.mjs';

export const privateHeaders = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'same-origin',
};

export function fail(err) {
  if (!(err instanceof WorkflowError)) console.error('SiteBefore request failed:', err?.name ?? 'Error');
  return new Response(err instanceof WorkflowError ? err.message : 'Something went wrong. Please try again.', {
    status: err instanceof WorkflowError ? err.status : 500, headers: privateHeaders,
  });
}

export function privateRedirect(location) {
  return new Response(null, { status: 303, headers: { ...privateHeaders, location } });
}

export function sameOrigin(request) {
  const target = new URL(request.url);
  if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('origin') !== target.origin) {
    throw new WorkflowError('Submit the form from SiteBefore.', 403);
  }
}

export async function readBody(request, limit = 45000) {
  if (Number(request.headers.get('content-length')) > limit) throw new WorkflowError('Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return body + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel();
      throw new WorkflowError('Request is too large.', 413);
    }
    body += decoder.decode(value, { stream: true });
  }
}

export async function readForm(request, limit) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new WorkflowError('Use the SiteBefore form.', 415);
  }
  return new URLSearchParams(await readBody(request, limit));
}

const cookieName = 'sitebefore_operator';
function sign(input, key) {
  return createHmac('sha256', key).update(input).digest('base64url');
}
function equal(a, b) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function operatorKey() {
  const key = process.env.SITEBEFORE_OPERATOR_KEY;
  return key?.length >= 32 ? key : null;
}

export function isOperator(cookies) {
  const key = operatorKey();
  const token = cookies.get(cookieName)?.value;
  if (!key || !token) return false;
  const [expires, mac, extra] = token.split('.');
  return !extra && !!mac && /^\d+$/.test(expires) && Number(expires) > Date.now() &&
    equal(mac, sign('session:' + expires, key));
}

export function logIn(cookies, supplied, requestURL) {
  const key = operatorKey();
  if (!key) throw new WorkflowError('Operator access is unavailable.', 503);
  if (!equal(sign('login:' + supplied, key), sign('login:' + key, key))) {
    throw new WorkflowError('The operator key did not match.', 401);
  }
  const seconds = 3600;
  const expires = String(Date.now() + seconds * 1000);
  cookies.set(cookieName, expires + '.' + sign('session:' + expires, key), {
    httpOnly: true, secure: new URL(requestURL).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: seconds,
  });
}

export function logOut(cookies) {
  cookies.delete(cookieName, { path: '/' });
}
