import { useEffect, useRef, useState } from 'react';

/**
 * Drop files/folders from Finder / Explorer onto a workspace card (or the
 * workspace detail view, or the top/bottom dock bar) to add them to that
 * workspace as references — `apps` entries of appType 'file' / 'folder', the
 * same shape /new-workspace and the card's own items use. Nothing on disk is
 * created or moved; the item just opens the original.
 *
 * Drop targets are any element carrying `data-workspace-id`. OS drops don't
 * reach the page as HTML5 drop events with real paths — Tauri reports them on
 * the webview instead (`onDragDropEvent`, with paths + a cursor position), so
 * the target is found by hit-testing that position against the DOM.
 *
 * Mounted once per window (CoolDeskContainer). Desktop app only — renders
 * nothing and listens to nothing elsewhere.
 */

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const TARGET_CLASS = 'is-file-drop-target';

const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

export function WorkspaceFileDrop() {
  const [toast, setToast] = useState(null); // { text, kind }
  const toastTimer = useRef(null);
  const hoverEl = useRef(null);

  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten = null;
    let cancelled = false;

    const showToast = (text, kind = 'success') => {
      clearTimeout(toastTimer.current);
      setToast({ text, kind });
      toastTimer.current = setTimeout(() => setToast(null), 2600);
    };

    const setHover = (el) => {
      if (hoverEl.current === el) return;
      hoverEl.current?.classList.remove(TARGET_CLASS);
      hoverEl.current = el;
      el?.classList.add(TARGET_CLASS);
    };

    (async () => {
      const [{ getCurrentWebview }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/webview'),
        import('@tauri-apps/api/core'),
      ]);

      // Tauri reports the cursor in physical pixels; the DOM hit-test needs CSS px.
      const targetAt = (position) => {
        if (!position) return null;
        const scale = window.devicePixelRatio || 1;
        const el = document.elementFromPoint(position.x / scale, position.y / scale);
        return el?.closest?.('[data-workspace-id]') || null;
      };

      const addToWorkspace = async (workspaceId, paths) => {
        const { getWorkspace, saveWorkspace } = await import('../../db/index.js');
        const res = await getWorkspace(workspaceId);
        const ws = res?.success ? res.data : res;
        if (!ws?.id) throw new Error('workspace not found');

        const kinds = await invoke('path_kinds', { paths });
        const existing = new Set((ws.apps || []).map(a => String(a.path || '').toLowerCase()));
        const added = [];
        let missing = 0;
        for (const k of kinds) {
          if (!k.exists) { missing++; continue; }
          const key = k.path.toLowerCase();
          if (existing.has(key)) continue;
          existing.add(key);
          added.push({ name: baseName(k.path), path: k.path, appType: k.is_dir ? 'folder' : 'file', icon: null });
        }
        if (added.length) {
          await saveWorkspace({ ...ws, apps: [...(ws.apps || []), ...added], updatedAt: Date.now() });
        }
        return { ws, added: added.length, skipped: kinds.length - added.length - missing, missing };
      };

      const off = await getCurrentWebview().onDragDropEvent(async (event) => {
        const { type, position, paths } = event.payload || {};
        if (type === 'enter' || type === 'over') {
          setHover(targetAt(position));
          return;
        }
        if (type === 'leave') {
          setHover(null);
          return;
        }
        if (type !== 'drop') return;

        const target = targetAt(position);
        setHover(null);
        // Dropped anywhere that isn't a workspace — deliberately a no-op.
        if (!target || !paths?.length) return;

        try {
          const { ws, added, skipped, missing } = await addToWorkspace(target.dataset.workspaceId, paths);
          if (added) {
            showToast(`Added ${added} item${added === 1 ? '' : 's'} to “${ws.name}”${skipped ? ` · ${skipped} already there` : ''}`);
          } else if (skipped) {
            showToast(`Already in “${ws.name}”`, 'info');
          } else if (missing) {
            showToast('Couldn’t read the dropped item', 'error');
          }
        } catch (err) {
          console.error('[WorkspaceFileDrop] add failed:', err);
          showToast('Couldn’t add to workspace — see console', 'error');
        }
      });
      if (cancelled) off(); else unlisten = off;
    })().catch(err => console.warn('[WorkspaceFileDrop] listener setup failed:', err));

    return () => {
      cancelled = true;
      unlisten?.();
      hoverEl.current?.classList.remove(TARGET_CLASS);
      hoverEl.current = null;
      clearTimeout(toastTimer.current);
    };
  }, []);

  if (!toast) return null;
  return (
    <div className={`workspace-drop-toast is-${toast.kind}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
