const USERNAME = 'JasperWu0214';
const PROFILE_URL = `https://github.com/users/${USERNAME}/contributions`;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=900',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function createHandler({ fetchImpl = fetch } = {}) {
  return async function handler() {
    try {
      const response = await fetchImpl(PROFILE_URL, {
        headers: { 'User-Agent': 'Jiazhou-Wu-Portfolio/1.0', Accept: 'text/html' },
      });
      if (!response.ok) return json(502, { error: 'GitHub contribution page unavailable' });
      const html = await response.text();
      const totalMatch = html.match(/id="js-contribution-activity-description"[^>]*>[\s\S]*?([\d,]+)\s*contributions\s+in the last year/i);
      const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null;
      const cells = [];
      const cellPattern = /<td[^>]*class="ContributionCalendar-day"[^>]*>/g;
      let match;
      while ((match = cellPattern.exec(html))) {
        const tag = match[0];
        const date = tag.match(/data-date="([^"]+)"/)?.[1];
        const level = tag.match(/data-level="(\d+)"/)?.[1];
        const id = tag.match(/id="([^"]+)"/)?.[1];
        if (!date || !id) continue;
        const tooltip = html.match(new RegExp(`<tool-tip[^>]*for="${id}"[^>]*>[\\s\\S]*?([^<]*contribution[^<]*)<\\/tool-tip>`, 'i'));
        const countMatch = tooltip?.[1]?.match(/([\d,]+)\s+contributions?/i);
        cells.push({ date, level: Number(level), count: countMatch ? Number(countMatch[1].replace(/,/g, '')) : 0 });
      }
      if (!Number.isFinite(total) || cells.length < 300) return json(502, { error: 'Contribution data incomplete' });
      // GitHub's table is ordered by weekday rows; the website grid needs date order.
      cells.sort((a, b) => a.date.localeCompare(b.date));
      return json(200, { username: USERNAME, total, contributions: cells });
    } catch (error) {
      console.error('GitHub contribution proxy failed:', error?.message || error);
      return json(502, { error: 'Could not load contribution data' });
    }
  };
}

export default createHandler();
