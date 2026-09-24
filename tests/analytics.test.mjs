import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHandler as createTrack } from '../netlify/functions/track.js';
import { createHandler as createReport, formatReport } from '../netlify/functions/daily-report.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test-only',
  ANALYTICS_SITE_ORIGIN: 'https://example.com', RESEND_API_KEY: 'test-mail-key',
  REPORT_EMAIL: 'owner@example.com', REPORT_FROM: 'Website <reports@example.com>',
};
const payload = {
  page: '/notes', timestamp: '2026-09-19T10:00:00.000Z',
  referrer: 'https://search.example/?secret=private', userAgent: 'Client claims browser',
  language: 'en-US', timezone: 'Asia/Tokyo',
};
const request = (body = payload, headers = {}, method = 'POST') => new Request('https://example.com/.netlify/functions/track', {
  method,
  headers: { origin: 'https://example.com', 'content-type': 'application/json', 'user-agent': 'Test Browser', ...headers },
  ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});

test('tracking stores one sanitized event and Netlify country, not client-supplied agent', async () => {
  const inserted = [];
  const handler = createTrack({ env, clientFactory: () => ({ from: () => ({ insert: async (row) => {
    inserted.push(row); return { error: null };
  } }) }) });
  const result = await handler(request(), { geo: { country: { code: 'CA' } } });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { recorded: true });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].referrer, 'https://search.example');
  assert.equal(inserted[0].user_agent, 'Test Browser');
  assert.equal(inserted[0].country, 'CA');
  assert.equal(inserted[0].created_at, undefined);
});

test('tracking validates CORS, methods, payload and configurable bot tokens', async () => {
  let writes = 0;
  const handler = createTrack({ env: { ...env, ANALYTICS_BOT_TOKENS: 'robot,spider' }, clientFactory: () => ({ from: () => ({ insert: async () => {
    writes++; return { error: null };
  } }) }) });
  assert.equal((await handler(request(payload, { origin: 'https://other.example' }))).status, 403);
  assert.equal((await handler(request(payload, {}, 'GET'))).status, 405);
  assert.equal((await handler(request(payload, {}, 'OPTIONS'))).status, 204);
  assert.equal((await handler(request({ ...payload, page: '//evil.example' }))).status, 400);
  assert.equal((await handler(request({ ...payload, page: '/?token=secret' }))).status, 400);
  assert.equal((await handler(request(payload, { 'user-agent': 'SpiderCheck' }))).status, 200);
  assert.equal(writes, 0);
});

test('daily report uses previous UTC day, aggregates and sends one plain-text email', async () => {
  const calls = [];
  const rows = [
    { id: 1, page: '/', referrer: 'https://google.com', country: 'CA' },
    { id: 2, page: '/', referrer: '', country: null },
    { id: 3, page: '/notes', referrer: 'https://google.com', country: 'JP' },
  ];
  const query = {
    select() { return this; },
    gte(field, value) { calls.push([field, value]); return this; },
    lt(field, value) { calls.push([field, value]); return this; },
    order() { return this; },
    async range() { return { data: rows, error: null }; },
  };
  const handler = createReport({ env, now: () => new Date('2026-09-20T00:00:02Z'),
    clientFactory: () => ({ from: () => query }),
    fetchImpl: async (_url, options) => { calls.push(options); return new Response('{}'); },
  });
  assert.equal((await handler()).status, 204);
  assert.deepEqual(calls.slice(0, 2), [
    ['created_at', '2026-09-19T00:00:00.000Z'],
    ['created_at', '2026-09-20T00:00:00.000Z'],
  ]);
  const mail = JSON.parse(calls[2].body);
  assert.equal(mail.subject, 'Daily Website Traffic Report');
  assert.deepEqual(mail.to, ['owner@example.com']);
  assert.match(mail.text, /Total visits: 3/);
  assert.match(mail.text, /\/: 2/);
  assert.match(mail.text, /https:\/\/google.com: 2/);
  assert.match(mail.text, /CA: 1/);
  assert.match(mail.text, /JP: 1/);
  assert.equal(calls[2].headers['Idempotency-Key'], 'website-traffic/2026-09-19/owner@example.com');
});

test('empty report is valid and a failed email is surfaced', async () => {
  assert.match(formatReport([], '2026-09-19'), /Total visits: 0/);
  const query = { select() { return this; }, gte() { return this; }, lt() { return this; },
    order() { return this; }, async range() { return { data: [], error: null }; } };
  const handler = createReport({ env, clientFactory: () => ({ from: () => query }),
    fetchImpl: async () => new Response('{}', { status: 500 }),
  });
  assert.equal((await handler()).status, 502);
});

test('browser script sends referrer origin and no query or identity storage', async () => {
  const script = await readFile(new URL('../analytics.js', import.meta.url), 'utf8');
  const calls = [];
  vm.runInNewContext(script, {
    navigator: { webdriver: false, doNotTrack: '0', userAgent: 'Browser', language: 'en-US' },
    window: { doNotTrack: '0' }, location: { pathname: '/notes' },
    document: { referrer: 'https://search.example/find?private=yes' },
    Intl, Date, URL, fetch: async (...args) => { calls.push(args); return new Response(null, { status: 204 }); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/.netlify/functions/track');
  const sent = JSON.parse(calls[0][1].body);
  assert.equal(sent.referrer, 'https://search.example');
  assert.equal(sent.page, '/notes');
  assert.ok(!calls[0][1].body.includes('private=yes'));
});
