// Floating Navbar Injection (Footer) across all websites
export function injectFooterBar() {
  try {
    const FLAG_ID = 'cooldesk-floating-bar-root';
    if (document.getElementById(FLAG_ID)) return; // already injected

    // Persisted visibility (per-origin)
    const STORAGE_KEY = '__cooldesk_bar_hidden__';
    const isHidden = () => {
      try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
    };
    const setHidden = (v) => {
      try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { }
    };

    // Create host + shadow
    const host = document.createElement('div');
    host.id = FLAG_ID;
    // Keep host at end to be above other positioned elements
    (document.documentElement || document.body).appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host, * { all: revert; }
      .bar {
        position: fixed;
        left: 0; right: 0; bottom: 0;
        z-index: 2147483647;
        box-sizing: border-box;
        width: 100%;
        padding-left: 4vw; padding-right: 4vw;
        padding-top: 8px; padding-bottom: 8px;
        background: rgba(13, 19, 32, 0.9);
        color: #e5e7eb;
        backdrop-filter: blur(8px);
        border-top: 1px solid #273043;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.25);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        transition: transform 160ms ease-in-out;
        transform: translateY(0);
      }
      @media (min-width: 700px) and (max-width: 999px) {
        .bar { padding-left: 8vw; padding-right: 8vw; }
      }
      @media (min-width: 1000px) {
        .bar { padding-left: 15vw; padding-right: 15vw; }
      }
      .inner {
        display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap;
      }
      .brand {
        display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #2563eb; border-radius: 10px;
        background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
        color: #fff; font-weight: 700; font-size: 13px;
      }
      .actions { display: flex; align-items: center; gap: 8px; }
      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        height: 28px; min-width: 28px; padding: 0 10px; gap: 6px;
        border-radius: 8px; border: 1px solid #273043; color: #cbd5e1; background: #0f1522;
        cursor: pointer; user-select: none; font-size: 12px; text-decoration: none;
      }
      .btn:hover { filter: brightness(1.1); }
      .search {
        flex: 1 1 260px; min-width: 180px; max-width: 520px;
        background: #0e121a; border: 1px solid #273043; color: #e5e7eb; border-radius: 8px;
        padding: 8px 10px; outline: none;
      }
      .hide {
        position: absolute; right: calc(8px + 4vw); bottom: calc(8px + 36px);
        background: rgba(13, 19, 32, 0.9); color: #cbd5e1; border: 1px solid #273043; border-radius: 6px;
        padding: 4px 8px; cursor: pointer; font-size: 12px;
      }
      @media (min-width: 700px) and (max-width: 999px) { .hide { right: calc(8px + 8vw); } }
      @media (min-width: 1000px) { .hide { right: calc(8px + 15vw); } }

      /* Tabs panel */
      .panel {
        position: fixed; left: 50%; transform: translateX(-50%);
        bottom: 46px; /* bar height + spacing */
        width: min(860px, 92vw);
        background: rgba(10, 14, 22, 0.98);
        border: 1px solid #273043; border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        padding: 8px;
        display: none;
      }
      .panel.open { display: block; }
      .panel-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
      .panel-head input { flex:1; padding:8px 10px; border-radius:8px; border:1px solid #273043; background:#0e121a; color:#e5e7eb; outline:none; }
      .tab-list { max-height: 50vh; overflow:auto; display:flex; flex-direction:column; gap:4px; }
      .tab-item { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; border:1px solid transparent; cursor:pointer; }
      .tab-item:hover { background:#0f1522; border-color:#273043; }
      .tab-item.active { background:#182235; border-color:#35507a; }
      .tab-title { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#e5e7eb; font-size:12px; }
      .tab-url { color:#94a3b8; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:40%; }
      .tab-actions { display:flex; gap:6px; }
      .tab-actions .x { background:#2b0f10; border-color:#541d20; color:#fca5a5; }
      .favicon { width:16px; height:16px; border-radius:3px; background:#273043; }

      /* Hover zone to reveal bar */
      .hover-zone {
        position: fixed; left: 0; right: 0; bottom: 0; height: 6px; width: 100%;
        z-index: 2147483646; /* just below the bar */
        background: transparent; /* invisible */
        cursor: default;
      }
      .bar.collapsed { transform: translateY(100%); }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'bar';
    wrap.style.display = isHidden() ? 'none' : 'block';
    // When not hidden, default to collapsed so it shows on hover
    if (!isHidden()) {
      wrap.classList.add('collapsed');
    }

    const inner = document.createElement('div');
    inner.className = 'inner';
    inner.innerHTML = `
      <div class="brand">Cool-Desk</div>
      <input class="search" type="text" placeholder="Search Everything..." />
      <div class="actions">
        <button class="btn" data-action="prevTab">◀ Prev</button>
        <button class="btn" data-action="nextTab">Next ▶</button>
        <button class="btn" data-action="tabs">Tabs</button>
        <button class="btn" data-action="back">Back</button>
        <button class="btn" data-action="forward">Forward</button>
        <button class="btn" data-action="reload">Reload</button>
        <button class="btn" data-action="open">Open Cool-Desk</button>
        <button class="btn" data-action="sidebar">Open Sidebar</button>
        <button class="btn" data-action="hide">Hide</button>
      </div>
    `;

    // Tabs panel host
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="panel-head">
        <input type="text" class="panel-filter" placeholder="Filter tabs by title or URL" />
        <button class="btn" data-action="refreshTabs">Refresh</button>
        <button class="btn" data-action="closePanel">Close</button>
      </div>
      <div class="tab-list"></div>
    `;

    wrap.appendChild(inner);
    // Hover zone (always present but inert if hidden)
    const hoverZone = document.createElement('div');
    hoverZone.className = 'hover-zone';

    shadow.appendChild(style);
    shadow.appendChild(wrap);
    shadow.appendChild(panel);
    shadow.appendChild(hoverZone);

    // Events
    const qs = (sel) => shadow.querySelector(sel);
    const openExt = () => {
      try { window.open(chrome.runtime.getURL('index.html'), '_blank'); } catch { }
    };
    qs('.actions .btn[data-action="open"]').addEventListener('click', openExt);

    qs('.actions .btn[data-action="sidebar"]').addEventListener('click', () => {
      // Ask background to open side panel (content scripts cannot directly open it on all browsers)
      try { chrome.runtime.sendMessage({ type: 'openSidePanel' }); } catch { }
    });

    let hideTimer = null;
    const cancelHideTimer = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } };
    const actuallyHide = () => { wrap.style.display = 'none'; wrap.classList.add('collapsed'); };
    const hideBar = () => { actuallyHide(); setHidden(true); };
    const showBar = () => { wrap.style.display = 'block'; wrap.classList.remove('collapsed'); setHidden(false); };
    qs('.actions .btn[data-action="hide"]').addEventListener('click', hideBar);

    // Search enter => open Google in new tab as a safe default
    const input = qs('.search');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = (input.value || '').trim();
        if (!q) return;
        try { window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, '_blank'); } catch { }
      }
    });

    // Page nav controls
    qs('.actions .btn[data-action="back"]').addEventListener('click', () => { try { history.back(); } catch {} });
    qs('.actions .btn[data-action="forward"]').addEventListener('click', () => { try { history.forward(); } catch {} });
    qs('.actions .btn[data-action="reload"]').addEventListener('click', () => { try { location.reload(); } catch {} });

    // Tabs quick controls
    qs('.actions .btn[data-action="prevTab"]').addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'switchTabRel', delta: -1 }); } catch {}
    });
    qs('.actions .btn[data-action="nextTab"]').addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ type: 'switchTabRel', delta: 1 }); } catch {}
    });

    // Tabs panel behavior
    const panelFilter = qs('.panel .panel-filter');
    const tabList = qs('.panel .tab-list');
    let tabsCache = [];
    const renderTabs = (filter = '') => {
      const f = (filter || '').toLowerCase();
      const items = tabsCache.filter(t => !f || (t.title?.toLowerCase().includes(f) || t.url?.toLowerCase().includes(f)));
      tabList.innerHTML = '';
      for (const t of items) {
        const el = document.createElement('div');
        el.className = 'tab-item' + (t.active ? ' active' : '');
        el.innerHTML = `
          <img class="favicon" src="${t.favIconUrl || ''}" onerror="this.style.display='none'" />
          <div class="tab-title">${(t.title || '(untitled)').replace(/</g,'&lt;')}</div>
          <div class="tab-url">${(t.url || '').replace(/</g,'&lt;')}</div>
          <div class="tab-actions">
            <button class="btn" data-id="${t.id}" data-act="activate">Switch</button>
            <button class="btn x" data-id="${t.id}" data-act="close">Close</button>
          </div>
        `;
        el.querySelector('[data-act="activate"]').addEventListener('click', () => {
          try { chrome.runtime.sendMessage({ type: 'activateTab', id: t.id }); } catch {}
        });
        el.querySelector('[data-act="close"]').addEventListener('click', () => {
          try { chrome.runtime.sendMessage({ type: 'closeTab', id: t.id }, () => fetchTabs()); } catch {}
        });
        tabList.appendChild(el);
      }
    };

    const fetchTabs = () => {
      try {
        chrome.runtime.sendMessage({ type: 'getTabs' }, (res) => {
          if (res && res.ok && Array.isArray(res.tabs)) {
            tabsCache = res.tabs;
            renderTabs(panelFilter.value);
          }
        });
      } catch {}
    };

    qs('.actions .btn[data-action="tabs"]').addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        fetchTabs();
        panelFilter.focus();
      }
    });
    panel.querySelector('[data-action="closePanel"]').addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelector('[data-action="refreshTabs"]').addEventListener('click', fetchTabs);
    panelFilter.addEventListener('input', () => renderTabs(panelFilter.value));

    // Auto-hide on mouse leave, but not when panel is open
    const scheduleAutoHide = () => {
      cancelHideTimer();
      if (panel.classList.contains('open')) return;
      hideTimer = setTimeout(() => {
        // Do not hide if explicitly not hidden but we want hover behavior => collapse instead
        if (!isHidden()) {
          wrap.classList.add('collapsed');
        } else {
          actuallyHide();
        }
      }, 500);
    };

    wrap.addEventListener('mouseenter', () => { cancelHideTimer(); if (!isHidden()) { wrap.classList.remove('collapsed'); wrap.style.display = 'block'; } });
    wrap.addEventListener('mouseleave', scheduleAutoHide);
    panel.addEventListener('mouseenter', cancelHideTimer);
    panel.addEventListener('mouseleave', scheduleAutoHide);

    // Reveal on hover over the bottom edge when not persistently hidden
    hoverZone.addEventListener('mouseenter', () => {
      if (!isHidden()) { wrap.style.display = 'block'; wrap.classList.remove('collapsed'); }
    });

    // Keyboard toggle: Alt+` (backtick)
    window.addEventListener('keydown', (e) => {
      try {
        if (e.altKey && (e.key === '`' || e.code === 'Backquote')) {
          if (wrap.style.display === 'none' || wrap.classList.contains('collapsed')) showBar(); else hideBar();
        }
      } catch { }
    }, true);
  } catch (e) {
    // ignore
  }
}

export default injectFooterBar;
