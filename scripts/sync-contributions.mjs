import { writeFile } from 'node:fs/promises';
const now = new Date();
const today = now.toISOString().slice(0, 10);
const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const contributions = [];
for (let year = 2025; year <= now.getUTCFullYear(); year++) {
  const end = year === now.getUTCFullYear() ? today : `${year}-12-31`;
  const query = `{user(login:"JasperWu0214"){contributionsCollection(from:"${year}-01-01T00:00:00Z",to:"${end}T23:59:59Z"){contributionCalendar{weeks{contributionDays{date contributionCount contributionLevel}}}}}}`;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({query}), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || data.errors) throw new Error(JSON.stringify(data.errors || response.status));
  const days = data.data.user.contributionsCollection.contributionCalendar.weeks.flatMap(w => w.contributionDays)
    .filter(d => d.date >= `${year}-01-01` && d.date <= end)
    .map(d => ({date:d.date, count:d.contributionCount, level:levels.indexOf(d.contributionLevel)}));
  const expected = Math.round((Date.parse(end)-Date.parse(`${year}-01-01`))/86400000)+1;
  if (days.length !== expected || days.some(d => d.level < 0)) throw new Error('Incomplete contribution calendar');
  contributions.push(...days);
}
contributions.sort((a,b) => a.date.localeCompare(b.date));
await writeFile('github-contributions.json', JSON.stringify({username:'JasperWu0214', total:contributions.reduce((sum,d)=>sum+d.count,0), startDate:'2025-01-01', endDate:today, updatedAt:today, contributions}));
