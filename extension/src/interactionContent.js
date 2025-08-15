// Send user interactions to background script
function sendInteraction(type, extra = {}) {
  try {
    chrome.runtime.sendMessage({ type, url: window.location.href, ...extra });
  } catch {}
}

// Scroll tracking (report scroll percentage at most every 3s; only if change > 5%)
let lastScrollPercent = 0;
setInterval(() => {
  const total = Math.max(1, document.documentElement.scrollHeight || document.body.scrollHeight || 1);
  const viewportBottom = (window.scrollY || window.pageYOffset || 0) + window.innerHeight;
  const scrollPercent = Math.max(0, Math.min(1, viewportBottom / total));
  if (Math.abs(scrollPercent - lastScrollPercent) >= 0.05) {
    lastScrollPercent = scrollPercent;
    sendInteraction('scroll', { scrollPercent: Number(scrollPercent.toFixed(3)) });
  }
}, 3000);

// Click tracking
addEventListener('click', (e) => {
  const tag = e.target && e.target.tagName ? e.target.tagName : 'UNKNOWN';
  sendInteraction('click', { element: tag });
}, true);

// Form submission tracking
addEventListener('submit', (e) => {
  const id = e.target && (e.target.id || e.target.name) ? (e.target.id || e.target.name) : null;
  sendInteraction('formSubmit', { formId: id });
}, true);

// Visibility change
addEventListener('visibilitychange', () => {
  sendInteraction('visibility', { visible: !document.hidden });
});
