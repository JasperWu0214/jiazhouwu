(() => {
  'use strict';
  if (navigator.webdriver || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  // Only one event per page load. No cookies, local storage, IP or identifiers.
  let referrer = '';
  try {
    if (document.referrer) referrer = new URL(document.referrer).origin;
  } catch { /* Ignore an invalid referrer. */ }

  const payload = {
    page: location.pathname,
    timestamp: new Date().toISOString(),
    referrer,
    userAgent: navigator.userAgent || '',
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  };
  fetch('/.netlify/functions/track', {
    method: 'POST',
    mode: 'same-origin',
    credentials: 'omit',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => { /* Analytics must never interfere with the site. */ });
})();
