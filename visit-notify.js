(() => {
  'use strict';
  if (location.protocol !== 'https:' || navigator.webdriver) return;
  const KEY = 'website-visit-notification-v1';
  const WINDOW = 30 * 60 * 1000;
  let running = false;
  let memory;
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || memory; } catch { return memory; }
  };
  const write = (value) => {
    memory = value;
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Cookies still deduplicate. */ }
  };
  async function notify() {
    try {
      if (localStorage.getItem('visit-notify-disabled') === '1') return;
    } catch { /* Storage may be blocked. */ }
    let record = read();
    const age = Date.now() - record?.event?.at;
    if (!(age >= 0 && age < WINDOW)) {
      let referrer = '';
      try { referrer = new URL(document.referrer).origin; } catch { /* Direct visit. */ }
      record = { sent: false, event: {
        id: crypto.randomUUID(), at: Date.now(), path: location.pathname, referrer,
      } };
      write(record);
    }
    if (record.sent) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('/api/visit-notify', {
          method: 'POST', credentials: 'same-origin', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record.event), signal: AbortSignal.timeout(12000),
        });
        if (response.ok) { record.sent = true; write(record); return; }
        if (response.status < 500 && response.status !== 429) return;
      } catch { /* Retry the same event ID, never create a second email. */ }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 3000));
    }
  }
  function start() {
    if (document.visibilityState !== 'visible' || running) return;
    running = true;
    const job = navigator.locks
      ? navigator.locks.request(KEY, notify)
      : notify();
    job.catch(() => {}).finally(() => { running = false; });
  }
  document.addEventListener('visibilitychange', start);
  window.addEventListener('online', start);
  start();
})();
