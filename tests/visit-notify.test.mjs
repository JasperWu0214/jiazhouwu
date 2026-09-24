import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHandler } from '../netlify/functions/visit-notify.mjs';

const now = Date.now();
const env = {
  RESEND_API_KEY: 'test-only-key', VISIT_NOTIFY_TO: 'owner@example.com',
  VISIT_NOTIFY_FROM: 'website@example.com', VISIT_SITE_URL: 'https://example.com',
};
const event = {
  id: '53e94d50-e9a5-441c-9cff-2c1e48d12f67', at: now, path: '/',
  referrer: 'https://search.example/?private=secret',
};
function request(body = event, headers = {}, method = 'POST') {
  return new Request('https://example.com/api/visit-notify', {
    method, headers: { origin: env.VISIT_SITE_URL, 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}
function setup(status = 200, overrides = {}) {
  const calls = [];
  const handler = createHandler({ env, now: () => now, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return new Response('{}', { status });
  }, ...overrides });
  return { handler, calls };
}

test('emails only configured recipient, strips source query, and signs a cooldown cookie', async () => {
  const { handler, calls } = setup();
  const response = await handler(request({ ...event, to: 'attacker@example.com' }));
  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  const mail = JSON.parse(calls[0].body);
  assert.deepEqual(mail.to, [env.VISIT_NOTIFY_TO]);
  assert.ok(mail.text.includes('https://search.example'));
  assert.ok(!mail.text.includes('private=secret'));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await handler(request(event, { cookie }))).status, 204);
  assert.equal(calls.length, 1);
  // A forged cookie must not suppress mail.
  await handler(request(event, { cookie: cookie.slice(0, -1) + 'z' }));
  assert.equal(calls.length, 2);
});

test('rejects invalid and cross-site traffic before invoking the mail provider', async () => {
  const { handler, calls } = setup();
  for (const [req, status] of [
    [new Request('https://example.com/.netlify/functions/visit-notify', { method: 'POST' }), 404],
    [request(event, { origin: 'https://evil.example' }), 403],
    [request(event, { 'sec-fetch-site': 'cross-site' }), 403],
    [request(event, { 'content-type': 'text/plain' }), 415],
    [request(event, {}, 'GET'), 405],
    [request('x'.repeat(4097)), 413],
    [request('{broken'), 400],
    [request({ ...event, path: '//evil.example/' }), 400],
    [request({ ...event, path: '/?secret=yes' }), 400],
    [request({ ...event, at: now - 31 * 60000 }), 400],
  ]) assert.equal((await handler(req)).status, status);
  assert.equal(calls.length, 0);
});

test('failed sending does not set cooldown; retries have identical payloads and keys', async () => {
  const { handler, calls } = setup(500);
  const response = await handler(request());
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('set-cookie'), null);
  await handler(request());
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('missing configuration, disabled alerts, bots and previews do not send mail', async () => {
  const missing = setup(200, { env: {} });
  assert.equal((await missing.handler(request())).status, 503);
  const disabled = setup(200, { env: { ...env, VISIT_NOTIFICATIONS_ENABLED: 'false' } });
  assert.equal((await disabled.handler(request())).status, 204);
  const { handler, calls } = setup();
  assert.equal((await handler(request(), { deploy: { context: 'deploy-preview' } })).status, 204);
  assert.equal((await handler(request(event, { 'user-agent': 'Googlebot' }))).status, 204);
  assert.equal(calls.length + missing.calls.length + disabled.calls.length, 0);
});

test('confirmed site and recipient work with only a server-side API key', async () => {
  const { handler, calls } = setup(200, { env: { RESEND_API_KEY: 'test-only-key' } });
  const req = new Request('https://jiazhouwu.netlify.app/api/visit-notify', {
    method: 'POST',
    headers: { origin: 'https://jiazhouwu.netlify.app', 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  assert.equal((await handler(req)).status, 204);
  const mail = JSON.parse(calls[0].body);
  assert.deepEqual(mail.to, ['jasperwu0214@gmail.com']);
  assert.ok(mail.text.includes('https://jiazhouwu.netlify.app/'));
});

const script = await readFile(new URL('../visit-notify.js', import.meta.url), 'utf8');
test('browser suppresses reloads, creates a new event after 30 minutes, and retries identical events', async () => {
  const storage = new Map();
  const calls = [];
  let failures = 1;
  let clock = now;
  const context = {
    location: { protocol: 'https:', pathname: '/' },
    navigator: { locks: { request: (_name, fn) => fn() } },
    document: { visibilityState: 'visible', referrer: 'https://search.example/?q=private', addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (_url, options) => { calls.push(options); return { ok: failures-- <= 0, status: 502 }; },
    crypto, URL, AbortSignal, Date: { now: () => clock },
    setTimeout: (fn) => { fn(); },
  };
  const run = async () => { vm.runInNewContext(script, context); await new Promise(setImmediate); };
  await run();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.ok(!calls[0].body.includes('q=private'));
  await run();
  assert.equal(calls.length, 2);
  clock += 31 * 60000;
  await run();
  assert.equal(calls.length, 3);
  assert.notEqual(JSON.parse(calls[0].body).id, JSON.parse(calls[2].body).id);
});
