import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WorkflowError } from './prospect.mjs';
import { getStore } from './store.mjs';

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
const sessionSeconds = 3600;
const sessionToken = /^[A-Za-z0-9_-]{43}$/;
const operatorName = /^[A-Za-z0-9_-]{1,64}$/;
const fallbackKey = randomBytes(32);
const failureWindow = 15 * 60 * 1000;
const maxFailureAddresses = 10_000;
const failures = new Map();
let nextPrune = 0;

function sign(input, key) {
  return createHmac('sha256', key).update(input).digest('base64url');
}
function equal(a, b) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function configuredOperators(env = process.env) {
  const operators = new Map();
  const keys = new Set();
  const add = (name, key) => {
    if (!operatorName.test(name) || key.length < 32 || operators.has(name) || keys.has(key)) {
      throw new WorkflowError('Invalid operator configuration: use unique operator names and distinct keys of at least 32 characters.', 503);
    }
    operators.set(name, key);
    keys.add(key);
  };
  if (env.SITEBEFORE_OPERATORS?.trim()) {
    for (const pair of env.SITEBEFORE_OPERATORS.split(',')) {
      const split = pair.indexOf(':');
      const name = pair.slice(0, split).trim();
      const key = pair.slice(split + 1).trim();
      add(split < 1 ? '' : name, key);
    }
  }
  const legacy = env.SITEBEFORE_OPERATOR_KEY;
  if (legacy && !operators.has('operator')) add('operator', legacy);
  return operators;
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');
const keyHash = key => sign('sitebefore:operator-session:v1', key);

export async function operatorSession(cookies) {
  const token = cookies.get(cookieName)?.value ?? '';
  const operators = configuredOperators();
  if (!sessionToken.test(token) || !operators.size) return null;
  const id = tokenHash(token);
  const row = await (await getStore()).operatorSession(id, Date.now());
  const key = row && operators.get(row.operator);
  return key && equal(row.key_hash, keyHash(key)) ? { id, name: row.operator } : null;
}

export function verifyOperatorLogin(name, supplied, address, now = Date.now()) {
  const operators = configuredOperators();
  if (!operators.size) throw new WorkflowError('Operator access is unavailable.', 503);
  if (now >= nextPrune) {
    for (const [ip, entry] of failures) if (entry.until <= now) failures.delete(ip);
    nextPrune = now + 60_000;
  }
  const previous = failures.get(address);
  const entry = previous?.until > now ? previous : { count: 0, until: now + failureWindow };
  if (entry.count >= 5) throw new WorkflowError('Too many sign-in attempts. Try again later.', 429);
  const key = operators.get(name);
  const comparisonKey = key ?? fallbackKey;
  const match = equal(keyHash(supplied || fallbackKey), keyHash(comparisonKey));
  if (!match || !key) {
    entry.count++;
    if (entry !== previous) {
      failures.delete(address);
      if (failures.size >= maxFailureAddresses) failures.delete(failures.keys().next().value);
    }
    failures.set(address, entry);
    throw new WorkflowError('The operator name or key did not match.', 401);
  }
  failures.delete(address);
  return keyHash(key);
}

export async function logIn(cookies, name, supplied, requestURL, address) {
  const verifier = verifyOperatorLogin(name, supplied, address);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await (await getStore()).createOperatorSession(tokenHash(token), name, verifier, now, now + sessionSeconds * 1000);
  cookies.set(cookieName, token, {
    httpOnly: true, secure: new URL(requestURL).protocol === 'https:', sameSite: 'strict', path: '/', maxAge: sessionSeconds,
  });
}

export async function logOut(cookies, session) {
  await (await getStore()).deleteOperatorSession(session.id, session.name);
  cookies.delete(cookieName, { path: '/' });
}
