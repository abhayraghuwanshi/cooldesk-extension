// Shared with GlobalSpotlight's Quick-Look-style PreviewPane and the
// in-app FileManager — one place for "which extensions can PreviewPane
// actually render, and as what kind" so the two surfaces can't drift apart.
// Images go straight to an <img>; everything in PREVIEW_CODE_LANGUAGES maps
// to the Prism grammar name PreviewPane has imported for it — anything else
// falls through to no preview rather than a wall of "unsupported" boxes.
const PREVIEW_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg']);

const PREVIEW_CODE_LANGUAGES = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'css', html: 'markup', htm: 'markup', xml: 'markup',
  md: 'markdown', markdown: 'markdown',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  rb: 'ruby', php: 'php', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  txt: 'markup', log: 'markup', env: 'bash', gitignore: 'bash',
  // NSIS installer scripts (e.g. src-tauri/nsis/*.nsh) — Prism has no NSIS
  // grammar, so this is plain unhighlighted text, same as .txt/.log.
  nsh: 'markup', nsi: 'markup',
};

const PREVIEW_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv']);
const PREVIEW_PDF_EXTS = new Set(['pdf']);

/** `{ path, previewKind, language? }` for PreviewPane, or null if this path's
 * extension has no renderer. */
export function getPreviewItem(path) {
  if (!path) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (PREVIEW_IMAGE_EXTS.has(ext)) return { path, previewKind: 'image' };
  if (PREVIEW_CODE_LANGUAGES[ext]) return { path, previewKind: 'code', language: PREVIEW_CODE_LANGUAGES[ext] };
  if (PREVIEW_VIDEO_EXTS.has(ext)) return { path, previewKind: 'video' };
  if (PREVIEW_PDF_EXTS.has(ext)) return { path, previewKind: 'pdf' };
  return null;
}
