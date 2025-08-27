// Send user interactions to background script
function sendInteraction(type, extra = {}) {
  try {
    chrome.runtime.sendMessage({ type, url: window.location.href, ...extra });
  } catch { }
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

// Collect preview data from the live DOM (for client-rendered pages)
function collectPreviewFromDom() {
  try {
    const getMeta = (name) => {
      const el = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
      return el ? el.getAttribute('content') || '' : '';
    };
    const absUrl = (u) => {
      try { return new URL(u, document.baseURI).toString(); } catch { return u || ''; }
    };
    const title = getMeta('og:title') || getMeta('twitter:title') || document.title || '';
    const description = getMeta('og:description') || getMeta('description') || getMeta('twitter:description') || '';
    const image = absUrl(getMeta('og:image') || getMeta('twitter:image'));
    let fallbackDesc = description;
    if (!fallbackDesc) {
      const h1 = document.querySelector('h1');
      const p = document.querySelector('main p, article p, p');
      fallbackDesc = (h1?.textContent || '').trim();
      const ptxt = (p?.textContent || '').trim();
      if (ptxt && (!fallbackDesc || ptxt.length > fallbackDesc.length)) fallbackDesc = ptxt;
    }
    return {
      source: location.hostname,
      title,
      description: description || fallbackDesc || '',
      image: image || '',
      url: location.href
    };
  } catch (e) {
    return { source: location.hostname, title: document.title || '', description: '', image: '', url: location.href };
  }
}

// Listen for preview collection requests from extension UI
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'collectPreview') {
      try {
        const data = collectPreviewFromDom();
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || 'Failed to collect preview' });
      }
      return true;
    }
  });
} catch { }

// Modular bootstrap (MV3-safe dynamic imports)
(() => {
  try {
    // Content interactions (analytics, preview collection)
    import(/* @vite-ignore */ chrome.runtime.getURL('src/contentInteractions.js'))
      .then(mod => { try { mod.initContentInteractions?.(); console.debug('[CoolDesk] contentInteractions loaded'); } catch (e) { console.warn('[CoolDesk] contentInteractions init failed', e); } })
      .catch((e) => { console.warn('[CoolDesk] Failed to import contentInteractions.js', e); });

    // Footer bar injection (tabs control UI)
    import(/* @vite-ignore */ chrome.runtime.getURL('src/footerBar.js'))
      .then(mod => { try { mod.injectFooterBar?.(); console.debug('[CoolDesk] footerBar loaded'); } catch (e) { console.warn('[CoolDesk] footerBar init failed', e); } })
      .catch((e) => { console.warn('[CoolDesk] Failed to import footerBar.js', e); });
  } catch { /* ignore */ }
})();
