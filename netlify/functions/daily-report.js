import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;

function rank(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = row[field] || (field === 'referrer' ? 'Direct / unknown' : 'Unknown');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function formatReport(rows, date) {
  const section = (title, entries) => [title, ...(entries.length ? entries.slice(0, 10).map(([name, count]) => `${name}: ${count}`) : ['None']), ''];
  return [
    `Website traffic summary for ${date} (UTC)`, '',
    `Total visits: ${rows.length}`, '',
    ...section('Top pages:', rank(rows, 'page')),
    ...section('Top referrers:', rank(rows, 'referrer')),
    ...section('Countries:', rank(rows, 'country')),
  ].join('\n');
}

export function createHandler({ env = process.env, clientFactory = createClient, fetchImpl = fetch, now = () => new Date() } = {}) {
  return async () => {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, REPORT_EMAIL, REPORT_FROM } = env;
    if (![SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY, REPORT_EMAIL, REPORT_FROM].every(Boolean)) {
      console.error('Daily report configuration is incomplete.');
      return new Response(null, { status: 503 });
    }
    const end = new Date(now());
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const date = start.toISOString().slice(0, 10);
    try {
      const db = clientFactory(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const rows = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await db.from('page_views')
          .select('id,page,referrer,country')
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString())
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      const result = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `website-traffic/${date}/${REPORT_EMAIL}`,
        },
        body: JSON.stringify({
          from: REPORT_FROM,
          to: [REPORT_EMAIL],
          subject: 'Daily Website Traffic Report',
          text: formatReport(rows, date),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error(`Resend status ${result.status}`);
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error('Daily report failed:', error?.message || 'unknown error');
      return new Response(null, { status: 502 });
    }
  };
}

export default createHandler();
