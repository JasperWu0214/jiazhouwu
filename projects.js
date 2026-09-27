(() => {
  'use strict';

  const USERNAME = 'JasperWu0214';
  const PROFILE = `https://github.com/${USERNAME}`;
  const API = 'https://api.github.com';
  const featured = ['blind75_note', 'MIT-Missing-Semester', 'jiazhouwu'];
  const fallbackRepositories = [
    {
      name: 'blind75_note',
      description: 'Blind 75 algorithm notes with problem-solving ideas, code, and complexity analysis.',
      language: null,
      stargazers_count: 1,
    },
    {
      name: 'MIT-Missing-Semester',
      description: 'Notes on the shell, command-line tools, and practical computing skills from MIT’s Missing Semester.',
      language: 'Shell',
      stargazers_count: 0,
    },
    {
      name: 'jiazhouwu',
      description: 'Source repository for this personal portfolio website.',
      language: 'HTML',
      stargazers_count: 1,
    },
  ];

  const githubLink = (path) => `${PROFILE}/${path.split('/').map(encodeURIComponent).join('/')}`;

  async function githubJSON(url) {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return response.json();
  }

  function renderCalendar(days, total) {
    const calendar = document.getElementById('github-contribution-calendar');
    const title = document.getElementById('github-contribution-title');
    if (!calendar || !title) return;
    const fragment = document.createDocumentFragment();
    const chronologicalDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
    // A partial first week still needs to line up with Sunday at the top.
    const firstWeekday = new Date(`${chronologicalDays[0].date}T00:00:00Z`).getUTCDay();
    for (let i = 0; i < firstWeekday; i++) {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      fragment.appendChild(spacer);
    }
    for (const day of chronologicalDays) {
      const cell = document.createElement('span');
      const count = Number(day.count) || 0;
      const date = typeof day.date === 'string' ? day.date : '';
      cell.className = 'github-day';
      cell.dataset.level = String(Math.max(0, Math.min(4, Number(day.level) || 0)));
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${count} contributions on ${date}`);
      cell.title = `${count} contributions on ${date}`;
      fragment.appendChild(cell);
    }
    calendar.replaceChildren(fragment);
    title.textContent = `${total} GitHub contributions in the last year`;
    // On narrow screens, keep the newest weeks visible instead of clipping them.
    const scrollArea = calendar.parentElement;
    if (scrollArea) scrollArea.scrollLeft = scrollArea.scrollWidth;
  }

  async function loadCalendar() {
    const calendar = document.getElementById('github-contribution-calendar');
    if (!calendar) return;
    try {
      const endpoint = location.protocol === 'file:'
        ? 'https://jiazhouwu.netlify.app/.netlify/functions/github-contributions'
        : '/.netlify/functions/github-contributions';
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Contribution activity unavailable');
      const data = await response.json();
      if (!Array.isArray(data.contributions) || !data.contributions.length) throw new Error('No contribution data');
      const total = Number(data.total);
      renderCalendar(data.contributions, total);
    } catch {
      const link = document.createElement('a');
      link.href = PROFILE;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'text-[#F8C4B4] hover:text-white';
      link.textContent = 'View contribution activity on GitHub ↗';
      calendar.replaceChildren(link);
    }
  }

  function repositoryCard(repo) {
    const card = document.createElement('a');
    card.href = githubLink(repo.name);
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.className = 'group flex min-h-[185px] flex-col rounded-xl border border-gray-600/60 bg-gray-800/75 p-5 shadow-lg hover:border-[#F8C4B4]/70 hover:-translate-y-1 transition-all duration-300';

    const header = document.createElement('div');
    header.className = 'flex flex-wrap items-start justify-between gap-3';
    const name = document.createElement('h4');
    name.className = 'text-[#F8C4B4] text-lg font-semibold break-all group-hover:text-white transition-colors';
    name.textContent = repo.name;
    const status = document.createElement('span');
    status.className = 'rounded-full border border-gray-500 px-2.5 py-0.5 text-xs text-gray-300';
    status.textContent = repo.archived ? 'Archived' : 'Public';
    header.append(name, status);

    const description = document.createElement('p');
    description.className = 'text-gray-300 text-sm leading-relaxed mt-4 flex-1';
    description.textContent = repo.description || 'Public GitHub repository.';

    const details = document.createElement('div');
    details.className = 'flex flex-wrap items-center justify-between gap-3 mt-5 text-sm text-gray-400';
    const metadata = document.createElement('span');
    const pieces = [repo.language, Number(repo.stargazers_count) > 0 ? `☆ ${repo.stargazers_count}` : null].filter(Boolean);
    metadata.textContent = pieces.join(' · ');
    const open = document.createElement('span');
    open.className = 'group-hover:text-[#F8C4B4] transition-colors';
    open.textContent = 'Open repository ↗';
    details.append(metadata, open);
    card.append(header, description, details);
    return card;
  }

  function renderRepositories(repositories) {
    const container = document.getElementById('github-repositories');
    if (!container) return;
    const sorted = [...repositories].sort((a, b) => {
      const aIndex = featured.indexOf(a.name);
      const bIndex = featured.indexOf(b.name);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? Infinity : aIndex) - (bIndex === -1 ? Infinity : bIndex);
      return new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0);
    });
    container.replaceChildren(...sorted.map(repositoryCard));
  }

  async function loadProjects() {
    let repositories = fallbackRepositories;
    try {
      const data = await githubJSON(`${API}/users/${USERNAME}/repos?type=owner&sort=pushed&per_page=100`);
      if (!Array.isArray(data) || !data.length) throw new Error('No public repositories');
      repositories = data.filter((repo) => repo.owner?.login === USERNAME && !repo.private && !repo.fork && /^[\w.-]+$/.test(repo.name));
      if (!repositories.length) throw new Error('No owned public repositories');
    } catch { /* Keep the known public repository links available. */ }
    renderRepositories(repositories);
  }

  loadCalendar();
  loadProjects();
})();
