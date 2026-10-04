// Opens the standalone spotlight window in /edit-workspace mode for a
// workspace. For surfaces of the main window that have no embedded spotlight:
// the sidebar (header hidden) and the top/bottom dock bar. See
// `open_spotlight_edit` in lib.rs and the listener in spotlight-main.jsx.
export async function openSpotlightEdit(workspace) {
  if (!workspace?.id) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_spotlight_edit', { workspace: { id: workspace.id, name: workspace.name } });
  } catch (e) {
    console.error('[SpotlightEdit] open_spotlight_edit failed:', e);
  }
}
