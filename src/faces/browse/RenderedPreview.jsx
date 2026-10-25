import { useEffect, useRef, useState } from 'react';

// Rendered view of a Markdown or HTML file for a file tab (FileTab's
// "Preview" switch). The result sits in a sandboxed frame with scripts off:
// it's same-origin with CoolDesk's own window, which can drive the terminal
// and every app command, so nothing from a file may run there. HTML that
// needs JavaScript therefore renders only partly — the Source view is the
// fallback. Relative images / styles resolve next to the file via the asset
// protocol; links open as Browse tabs instead of inside the frame.

const baseName = (p) => p.split(/[/\\]/).filter(Boolean).pop() || p;
const parentDir = (p) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
};

async function invoke(cmd, args) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(cmd, args);
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function markdownCss(light) {
  const c = light
    ? { bg: '#ffffff', text: '#1f2328', dim: '#59636e', line: '#d1d9e0', code: '#f6f8fa', link: '#0969da' }
    : { bg: '#0d1117', text: '#e6edf3', dim: '#9198a1', line: '#30363d', code: '#161b22', link: '#4493f8' };
  return `
    html { background: ${c.bg}; }
    body { margin: 0 auto; max-width: 860px; padding: 28px 36px 64px; color: ${c.text};
      font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; word-wrap: break-word; }
    h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.6em; line-height: 1.25; font-weight: 600; }
    h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid ${c.line}; }
    h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid ${c.line}; }
    h1:first-child, h2:first-child { margin-top: 0; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 16px; }
    a { color: ${c.link}; text-decoration: none; } a:hover { text-decoration: underline; }
    code, pre { font: 13px/1.5 "SF Mono", Menlo, Consolas, monospace; }
    :not(pre) > code { background: ${c.code}; padding: 0.15em 0.4em; border-radius: 6px; }
    pre { background: ${c.code}; padding: 14px 16px; border-radius: 8px; overflow: auto; }
    blockquote { margin-left: 0; padding: 0 1em; color: ${c.dim}; border-left: 4px solid ${c.line}; }
    table { border-collapse: collapse; display: block; overflow: auto; }
    th, td { border: 1px solid ${c.line}; padding: 6px 13px; }
    th { background: ${c.code}; }
    img { max-width: 100%; }
    hr { border: 0; border-top: 1px solid ${c.line}; margin: 24px 0; }
    input[type=checkbox] { margin-right: 6px; }
  `;
}

/**
 * @param path       the file
 * @param kind       'markdown' | 'html'
 * @param onOpenUrl  (url) → a web link clicked in the preview
 * @param onOpenPath (path) → a link to another local file
 */
export function RenderedPreview({ path, kind, onOpenUrl, onOpenPath }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);
  const frameRef = useRef(null);
  const handlers = useRef({ onOpenUrl, onOpenPath });
  handlers.current = { onOpenUrl, onOpenPath };

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    (async () => {
      try {
        const [{ content, truncated }, { convertFileSrc }] = await Promise.all([
          invoke('preview_text_file', { path }),
          import('@tauri-apps/api/core'),
        ]);
        // Trailing slash so relative URLs resolve inside the folder.
        const base = `<base href="${escapeHtml(convertFileSrc(parentDir(path)))}/">`;
        const light = document.body.classList.contains('bg-white-cred');
        let html;
        if (kind === 'markdown') {
          const { marked } = await import('marked');
          const body = marked.parse(content, { gfm: true });
          html = `<!doctype html><html><head><meta charset="utf-8">${base}<title>${escapeHtml(baseName(path))}</title>`
            + `<style>${markdownCss(light)}</style></head><body>${body}`
            + `${truncated ? '<p><em>(Preview cut short — the file is large.)</em></p>' : ''}</body></html>`;
        } else {
          // Put <base> first in <head> (or up front) so it applies to everything.
          html = /<head[^>]*>/i.test(content)
            ? content.replace(/<head[^>]*>/i, (m) => `${m}${base}`)
            : `${base}${content}`;
        }
        if (!cancelled) setDoc(html);
      } catch (err) {
        if (!cancelled) setError(String(err?.message || err) === 'Binary file' ? "This file isn't text." : "Couldn't read this file.");
      }
    })();
    return () => { cancelled = true; };
  }, [path, kind]);

  // Links: web ones open as tabs, local ones as file tabs; in-page anchors
  // scroll. Reachable because the frame is same-origin (scripts stay off).
  const onLoad = () => {
    const d = frameRef.current?.contentDocument;
    if (!d) return;
    d.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      const raw = a.getAttribute('href') || '';
      if (raw.startsWith('#')) return;
      e.preventDefault();
      const href = a.href;
      if (/^https?:\/\//i.test(href) && !/asset\.localhost/i.test(href)) {
        handlers.current.onOpenUrl?.(href);
        return;
      }
      // asset://… or http(s)://asset.localhost/… → the file on disk.
      try {
        const u = new URL(href);
        const local = decodeURIComponent(u.pathname).replace(/^\/+/, '/');
        if (local) handlers.current.onOpenPath?.(local.split('#')[0]);
      } catch { /* not a link we can follow */ }
    });
  };

  if (error) return <div className="fv-nopreview"><span>{error}</span></div>;
  if (doc === null) return <div className="bp-empty">Rendering…</div>;
  return (
    <iframe
      ref={frameRef}
      className={`rp-frame rp-${kind}`}
      title={`Preview of ${baseName(path)}`}
      sandbox="allow-same-origin"
      srcDoc={doc}
      onLoad={onLoad}
    />
  );
}
