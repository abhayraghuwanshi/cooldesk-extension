import { marked } from 'marked';
import { saveWorkspaceNote } from '../../db/index.js';

// A page clip (tools.js → browser-pane-clip) as a workspace note: the source
// link on top, then the clip — a real table, the chart (SVG, else an image),
// the element's image, or its text as rich text. Images live in app data
// (clips/), referenced through the asset protocol.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KIND_NAMES = { table: 'Table', chart: 'Chart', image: 'Image', text: 'Clip' };

function tableHtml(rows) {
  if (!rows?.length) return '';
  const width = Math.max(...rows.map(r => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const [head, ...body] = rows.map(pad);
  return `<table><tbody><tr>${head.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`
    + body.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    + '</tbody></table>';
}

/** HTML body for the note. */
export async function clipHtml(clip) {
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const img = (path) => (path ? `<p><img src="${esc(convertFileSrc(path))}" alt="${esc(clip.title || '')}"></p>` : '');
  const when = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const source = `<p>From <a href="${esc(clip.url)}">${esc(clip.title || clip.url)}</a> · ${esc(when)}</p>`;
  let body = '';
  if (clip.kind === 'table' && clip.rows?.length) body = tableHtml(clip.rows);
  else if (clip.kind === 'chart') body = img(clip.svgPath || clip.imagePath);
  else if (clip.kind === 'text' && clip.markdown) body = marked.parse(clip.markdown) + img(clip.imagePath);
  else body = img(clip.imagePath);
  return source + (body || '<p><em>Nothing could be captured from that element.</em></p>');
}

/** One-line description for the toast ("Table · 12 rows"). */
export function clipSummary(clip) {
  if (clip.kind === 'table' && clip.rows?.length) return `Table · ${Math.max(0, clip.rows.length - 1)} rows`;
  return KIND_NAMES[clip.kind] || 'Clip';
}

/** Save the clip as a note in `workspace`. Returns the note. */
export async function saveClipToWorkspace(clip, workspace) {
  const now = Date.now();
  const title = `${KIND_NAMES[clip.kind] || 'Clip'}: ${(clip.title || clip.url || 'page').slice(0, 80)}`;
  const note = {
    id: `wsnote_${now}_${Math.random().toString(36).slice(2, 7)}`,
    workspaceId: workspace.id,
    title,
    text: await clipHtml(clip),
    folder: workspace.name,
    type: 'richtext',
    createdAt: now,
    updatedAt: now,
  };
  await saveWorkspaceNote(note);
  // Open note lists (the panel's Notes section) reload.
  window.dispatchEvent(new CustomEvent('cooldesk-notes-changed', { detail: { workspaceId: workspace.id } }));
  return note;
}
