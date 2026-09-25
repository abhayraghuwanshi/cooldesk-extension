import { useCallback, useEffect, useState } from 'react';

// Fired on window whenever a workspace's accent color is changed from any view.
const EVENT = 'cooldesk:workspace-color';

/**
 * A workspace's accent (card) color, kept in sync across every view showing
 * that workspace. The same workspace is often on screen twice — the card and
 * its detail/context panel below it — and each used to hold its own copy
 * read once from `workspace.color`, so changing the color in one left the
 * other stale until it remounted.
 *
 * Returns [accent, setAccent]. `setAccent` updates this view immediately and
 * notifies the others; persisting the workspace record stays with the caller.
 */
export function useWorkspaceAccent(workspace) {
  const id = workspace?.id;
  const [accent, setAccentState] = useState(workspace?.color || null);

  // Follow the record itself when it's reloaded with a different color.
  useEffect(() => {
    setAccentState(workspace?.color || null);
  }, [id, workspace?.color]);

  // Follow edits made from another view of the same workspace.
  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.id === id) setAccentState(e.detail.color || null);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [id]);

  const setAccent = useCallback((color) => {
    setAccentState(color || null);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, color: color || null } }));
  }, [id]);

  return [accent, setAccent];
}
