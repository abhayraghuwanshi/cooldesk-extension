// CoolDesk widget runtime (v2).
// - Applies ?theme= from the query string (dark default).
// - `cooldesk.get(key, fallback)` reads config params.
// - `cooldesk.store` persists small state; localStorage is the synchronous
//   working copy (falls back to memory when the iframe sandbox gives an
//   opaque origin and localStorage throws).
// - Host bridge: the embedding app sends {type:'cooldesk:init'} with a
//   MessagePort; widget identity is the port, never e.origin. Widgets on the
//   public site simply run with no host (demo mode).
// - v2: when hosted, every store.set is mirrored to the host ('store.set'),
//   the full local state is pushed on connect ('store.backup'), and if the
//   local copy is empty (site data was cleared) the widget restores itself
//   from the host's snapshot and reloads once.
(function () {
  var params = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";
  // `?embed=host` lets the embedding app own the card surface: the widget body
  // goes transparent (see base.css) so the host's tile shows through, instead of
  // each widget painting its own — the surface then depends on *where* the widget
  // is used. Standalone/store use omits it and keeps the self-contained surface.
  if (params.get("embed") === "host") document.documentElement.dataset.embed = "host";

  // `?skin=name` — the host board's Workflow skin (terminal, notebook, …).
  // base.css re-tokens the widget (font, accent, radius, controls) to match.
  var skin = params.get("skin") || "";
  if (/^[a-z]+$/.test(skin)) document.documentElement.dataset.skin = skin;

  // `?lang=xx` — the host's UI language (src/shared/i18n). Widget text is
  // translated by i18n.js (built-in markup, once at load) and cooldesk.t()
  // (text a widget builds in code); dates use `cooldesk.locale`.
  var lang = (params.get("lang") || "en").toLowerCase();
  if (!/^[a-z]{2}$/.test(lang)) lang = "en";
  document.documentElement.lang = lang;

  // `?tint=RRGGBB` — the embedding board's per-widget accent. The card tints
  // itself rather than the host tinting it from outside, because the host can't
  // paint through an opaque iframe canvas. Also drives --accent so the widget's
  // own marks (bars, links, focus rings) agree with the card.
  var tint = (params.get("tint") || "").replace(/^#/, "");
  if (/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(tint)) {
    var root = document.documentElement.style;
    root.setProperty("--tint", "#" + tint);
    root.setProperty("--tint-strength", "22%");
    root.setProperty("--accent", "#" + tint);
  }

  // `?fitw=&fith=` — the widget's designed size. Glanceable widgets in a big
  // card scale up to fill it, and down as far as needed to fit a small one
  // (a 1×1 card is ~150px; a floor of 0.7 cropped the clock's sides). Capped
  // at 2.5× so text never gets absurd.
  var fitW = Number(params.get("fitw"));
  var fitH = Number(params.get("fith"));
  if (fitW > 0 && fitH > 0) {
    var docEl = document.documentElement;
    docEl.dataset.fit = "";
    var applyFit = function () {
      var s = Math.min(window.innerWidth / fitW, window.innerHeight / fitH);
      docEl.style.setProperty("--fit", Math.max(0.35, Math.min(2.5, s)).toFixed(3));
    };
    applyFit();
    window.addEventListener("resize", applyFit);
  }

  // `?center=1` — center the content (start pages put widgets alone in the
  // middle of the screen, where left-aligned text looks off-center).
  if (params.get("center") === "1") document.documentElement.dataset.center = "";

  var pending = new Map();
  var seq = 0;

  function readLocal() {
    var out = {};
    var n = 0;
    try { n = localStorage.length; } catch (e) { return out; }
    for (var i = 0; i < n; i++) {
      try {
        var k = localStorage.key(i);
        if (k && k.indexOf("cd:") === 0) out[k.slice(3)] = JSON.parse(localStorage.getItem(k));
      } catch (e) { /* skip unreadable key */ }
    }
    return out;
  }

  window.cooldesk = {
    version: 2,
    params: params,
    lang: lang,
    // BCP-47 for toLocale*String: the widget follows the app's language,
    // not the browser's.
    locale: lang === "zh" ? "zh-CN" : lang,
    // t("Session {n}", { n: 2 }) — keyed by the English text; falls back to
    // it when a language has no entry (window.CDI18N, from i18n.js).
    t: function (text, vars) {
      var row = window.CDI18N && window.CDI18N[text];
      var s = (lang !== "en" && row && row[lang]) || text;
      return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; }) : s;
    },
    // Monday-first weekday names in the widget's language ("short" | "narrow").
    weekdays: function (style) {
      var out = [];
      for (var i = 0; i < 7; i++) out.push(new Date(2024, 0, 1 + i).toLocaleDateString(window.cooldesk.locale, { weekday: style || "short" }));
      return out;
    },
    get: function (key, fallback) {
      var v = params.get(key);
      return v === null || v === "" ? fallback : v;
    },
    hosted: false,
    onHost: null,
    _port: null,
    call: function (method, args) {
      var port = this._port;
      if (!port) return Promise.reject(new Error("no-host"));
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
        port.postMessage({ id: id, method: method, args: args || {} });
      });
    },
    store: {
      _mem: {},
      get: function (key, fallback) {
        try {
          var raw = localStorage.getItem("cd:" + key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
          return key in this._mem ? this._mem[key] : fallback;
        }
      },
      set: function (key, value) {
        try {
          localStorage.setItem("cd:" + key, JSON.stringify(value));
        } catch (e) {
          this._mem[key] = value;
        }
        // Write-through to the host's durable store (fire-and-forget).
        if (window.cooldesk.hosted) {
          window.cooldesk.call("store.set", { key: key, value: value }).catch(function () { });
        }
      },
    },
  };

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (d && d.type === "cooldesk:init" && e.ports && e.ports[0]) {
      var port = e.ports[0];
      window.cooldesk._port = port;
      window.cooldesk.hosted = true;
      port.onmessage = function (ev) {
        var m = ev.data || {};
        var p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          if (m.error) p.reject(new Error(m.error));
          else p.resolve(m.result);
        }
      };
      port.postMessage({ id: 0, method: "ready", args: { version: 2 } });

      // Durable-store sync: push local data up, or pull it back down when
      // the local copy was wiped (e.g. the user cleared site data).
      var local = readLocal();
      if (Object.keys(local).length > 0) {
        window.cooldesk.call("store.backup", { data: local }).catch(function () { });
      } else {
        window.cooldesk.call("store.snapshot", {}).then(function (data) {
          if (!data || Object.keys(data).length === 0) return;
          var restored = false;
          try {
            if (sessionStorage.getItem("cd:restored")) return; // one reload max
            Object.keys(data).forEach(function (k) {
              localStorage.setItem("cd:" + k, JSON.stringify(data[k]));
            });
            sessionStorage.setItem("cd:restored", "1");
            restored = true;
          } catch (e) { /* opaque origin: memory mode, nothing to restore into */ }
          if (restored) location.reload();
        }).catch(function () { });
      }

      if (typeof window.cooldesk.onHost === "function") window.cooldesk.onHost();
    }
  });
})();
