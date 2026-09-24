import { createClient } from '@supabase/supabase-js';

export const config = {
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

const respond = (status, body, origin, extra = {}) => new Response(status === 204 ? null : JSON.stringify(body), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    ...(status === 204 ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    ...extra,
  },
});

function validText(value, max) {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function createHandler({ env = process.env, clientFactory = createClient } = {}) {
  return async (request, context = {}) => {
    const requestOrigin = request.headers.get('origin');
    const allowedOrigin = env.ANALYTICS_SITE_ORIGIN || new URL(request.url).origin;
    let origin;
    try { origin = new URL(allowedOrigin).origin; } catch { return respond(503, { error: 'Configuration unavailable' }); }
    if (requestOrigin && requestOrigin !== origin) return respond(403, { error: 'Origin not allowed' });
    if (request.headers.get('sec-fetch-site') === 'cross-site') return respond(403, { error: 'Origin not allowed' });
    if (request.method === 'OPTIONS') return respond(204, null, origin, {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    if (request.method !== 'POST') return respond(405, { error: 'Method not allowed' }, origin, { Allow: 'POST, OPTIONS' });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return respond(415, { error: 'JSON required' }, origin);

    const agent = request.headers.get('user-agent') || '';
    const tokens = (env.ANALYTICS_BOT_TOKENS || 'bot,crawler,spider,headless').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (tokens.some((token) => agent.toLowerCase().includes(token))) return respond(200, { recorded: false, reason: 'bot' }, origin);

    let input;
    try {
      if (Number(request.headers.get('content-length')) > 4096) return respond(413, { error: 'Payload too large' }, origin);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 4096) return respond(413, { error: 'Payload too large' }, origin);
      input = JSON.parse(raw);
    } catch { return respond(400, { error: 'Invalid JSON' }, origin); }
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        !validText(input.page, 1000) || !/^\/(?!\/)/.test(input.page) || input.page.includes('?') || input.page.includes('#') ||
        !validText(input.referrer, 2048) || !validText(input.userAgent, 1024) ||
        !validText(input.language, 64) || !validText(input.timezone, 128) ||
        typeof input.timestamp !== 'string' || !Number.isFinite(Date.parse(input.timestamp))) {
      return respond(400, { error: 'Invalid visit fields' }, origin);
    }
    let referrer = '';
    if (input.referrer) {
      try {
        const url = new URL(input.referrer);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        referrer = url.origin; // Discard paths, query strings and fragments.
      } catch { return respond(400, { error: 'Invalid referrer' }, origin); }
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return respond(503, { error: 'Analytics not configured' }, origin);

    // Server timestamp is authoritative; the client timestamp is not used for reporting.
    const country = context.geo?.country?.code;
    const row = {
      page: input.page,
      referrer,
      user_agent: agent.slice(0, 1024),
      language: input.language,
      timezone: input.timezone,
      country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null,
    };
    try {
      const db = clientFactory(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await db.from('page_views').insert(row);
      if (error) throw error;
      return respond(200, { recorded: true }, origin);
    } catch {
      console.error('Analytics insert failed.');
      return respond(502, { error: 'Could not record visit' }, origin);
    }
  };
}

export default createHandler();
