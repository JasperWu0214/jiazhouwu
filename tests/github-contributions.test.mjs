import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../netlify/functions/github-contributions.js';

test('GitHub weekday-row table becomes a chronological contribution calendar', async () => {
  const start = Date.UTC(2025, 8, 21); // Sunday
  const days = Array.from({ length: 371 }, (_, index) => {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    const count = index === 8 ? 3 : index === 20 ? 1 : 0;
    return { date, count, id: `day-${index}` };
  });
  const cells = Array.from({ length: 7 }, (_, weekday) =>
    days.filter((_, index) => index % 7 === weekday)
      .map(({ date, count, id }) => `<td class="ContributionCalendar-day" data-date="${date}" data-level="${count ? 2 : 0}" id="${id}"></td>`)
      .join('')
  ).join('');
  const tooltips = days.map(({ count, id }) => `<tool-tip for="${id}">${count} contribution${count === 1 ? '' : 's'} on a day</tool-tip>`).join('');
  const html = `<h2 id="js-contribution-activity-description">4 contributions in the last year</h2><table>${cells}</table>${tooltips}`;
  const handler = createHandler({ fetchImpl: async () => new Response(html) });
  const response = await handler();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 4);
  assert.deepEqual(data.contributions.map(({ date }) => date), days.map(({ date }) => date));
  assert.equal(data.contributions[8].count, 3);
  assert.equal(data.contributions[20].count, 1);
});
