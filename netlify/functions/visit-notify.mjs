import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = {
  path: '/api/visit-notify',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

const COOKIE = '__Host-visit-notified';
const WINDOW = 30 * 60 * 1000;
const reply = (status, headers = {}) => new Response(null, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
const sign = (value, key) => createHmac('sha256', key).update(value).digest('hex');

function recentlyNotified(request, key, now) {
  const cookie = (request.headers.get('cookie') || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!cookie) return false;
  const [expires, signature] = cookie.slice(COOKIE.length + 1).split('.');
  if (!/^\d{13}$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  const remaining = Number(expires) - now;
  return remaining > 0 && remaining <= WINDOW && timingSafeEqual(
    Buffer.from(signature, 'hex'), Buffer.from(sign(expires, key), 'hex'),
  );
}

// Dependency injection keeps verification entirely offline; no test emails are sent.
export function createHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  return async (request, context = {}) => {
    // Only the route covered by the edge rate limit may send mail.
    if (new URL(request.url).pathname !== '/api/visit-notify') return reply(404);
    if (request.method !== 'POST') return reply(405, { Allow: 'POST' });
    if (env.VISIT_NOTIFICATIONS_ENABLED === 'false') return reply(204);
    // Preview builds and local development should not trigger real mail.
    if (context.deploy?.context && context.deploy.context !== 'production') return reply(204);
    const key = env.RESEND_API_KEY;
    const to = env.VISIT_NOTIFY_TO || 'jasperwu0214@gmail.com';
    const from = env.VISIT_NOTIFY_FROM || 'Website visits <onboarding@resend.dev>';
    let origin;
    try {
      const site = new URL(env.VISIT_SITE_URL || 'https://jiazhouwu.netlify.app');
      if (site.protocol !== 'https:') throw new Error('HTTPS required');
      origin = site.origin;
    } catch { return reply(503); }
    if (!key || !to || !from) return reply(503);
    if (new URL(request.url).origin !== origin || request.headers.get('origin') !== origin) return reply(403);
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin') return reply(403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return reply(415);
    if (/bot|crawler|spider|headless|lighthouse|preview/i.test(request.headers.get('user-agent') || '')) return reply(204);
    const currentTime = now();
    if (recentlyNotified(request, key, currentTime)) return reply(204);

    // Enforce the limit while reading, even if Content-Length is absent or forged.
    let raw = '';
    if (!request.body) return reply(400);
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return reply(413); }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch { return reply(400); }

    let event, page, source;
    try {
      event = JSON.parse(raw);
      if (!event || !/^[a-f0-9-]{36}$/i.test(event.id)) throw new Error();
      if (!Number.isSafeInteger(event.at) || Math.abs(currentTime - event.at) > WINDOW) throw new Error();
      if (typeof event.path !== 'string' || !event.path.startsWith('/') || event.path.length > 1000) throw new Error();
      page = new URL(event.path, origin);
      if (page.origin !== origin || page.search || page.hash) throw new Error();
      source = event.referrer ? new URL(event.referrer) : null;
      if (source && !['https:', 'http:'].includes(source.protocol)) throw new Error();
    } catch { return reply(400); }

    // The payload is deterministic so retries use Resend's idempotency guarantee.
    // Query strings, fragments, IP addresses and user agent strings are not emailed.
    const timestamp = new Date(event.at).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', hour12: false,
    });
    const payload = {
      from, to: [to], subject: `网站有新访问 · ${new URL(origin).hostname}`,
      text: [
        '你的网站有一次新的浏览器访问。', '',
        `访问时间：${timestamp}（北京时间，浏览器上报）`,
        `访问页面：${page.origin}${page.pathname}`,
        `来源网站：${source ? source.origin : '直接访问或浏览器未提供'}`,
        '', '同一浏览器 30 分钟内通常只提醒一次。这不代表首次到访的独立访客。',
      ].join('\n'),
    };
    try {
      const result = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `visit/${new URL(origin).hostname}/${event.id}`,
        },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) {
        console.error('Visit notification email failed; provider status:', result.status);
        return reply(502);
      }
      const expires = String(currentTime + WINDOW);
      return reply(204, {
        'Set-Cookie': `${COOKIE}=${expires}.${sign(expires, key)}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict`,
      });
    } catch {
      console.error('Visit notification email failed: network error or timeout.');
      return reply(502);
    }
  };
}

export default createHandler();
