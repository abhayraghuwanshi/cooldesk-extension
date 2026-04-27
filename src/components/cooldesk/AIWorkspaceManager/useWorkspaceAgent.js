import { useCallback } from 'react';
import * as LocalAIService from '../../../services/localAIService';
import { safeGetHostname } from '../../../utils/helpers';

// ── AI backend resolver ───────────────────────────────────────────────────────

async function resolveChatFn() {
  try {
    const cloud = await LocalAIService.getCloudStatus();
    if (cloud?.configured) return LocalAIService.cloudSimpleChat;
  } catch { /* ignore */ }
  try {
    const local = await LocalAIService.isAvailable();
    if (local) return LocalAIService.simpleChat;
  } catch { /* ignore */ }
  return null;
}

// ── Tool 1: URL collector ─────────────────────────────────────────────────────
// Gathers tabs, recent history, and bookmarks into a unified numbered list

function collectUrlData(tabs = [], history = [], bookmarks = []) {
  const items = [];
  const seen = new Set();

  tabs.slice(0, 15).forEach((t, i) => {
    if (!t.url || seen.has(t.url)) return;
    seen.add(t.url);
    items.push({
      index: items.length + 1,
      tabIndex: i + 1,
      source: 'tab',
      title: t.title || safeGetHostname(t.url),
      domain: safeGetHostname(t.url),
      url: t.url,
      favicon: t.favicon || t.favIconUrl || null
    });
  });

  history.slice(0, 20).forEach(h => {
    if (!h.url || seen.has(h.url)) return;
    seen.add(h.url);
    items.push({
      index: items.length + 1,
      source: 'history',
      title: h.title || safeGetHostname(h.url),
      domain: safeGetHostname(h.url),
      url: h.url
    });
  });

  bookmarks.slice(0, 10).forEach(b => {
    if (!b.url || seen.has(b.url)) return;
    seen.add(b.url);
    items.push({
      index: items.length + 1,
      source: 'bookmark',
      title: b.title || safeGetHostname(b.url),
      domain: safeGetHostname(b.url),
      url: b.url,
      favicon: b.favicon || null
    });
  });

  return items;
}

// ── Tool 2: App collector ─────────────────────────────────────────────────────
// Collects running and installed desktop apps, excluding browsers

const BROWSER_NAMES = ['chrome', 'firefox', 'edge', 'safari', 'opera', 'brave', 'msedge'];

function isBrowser(name = '') {
  const n = name.toLowerCase();
  return BROWSER_NAMES.some(b => n.includes(b));
}

function collectAppData(runningApps = [], installedApps = []) {
  const running = runningApps
    .filter(a => a.name && !isBrowser(a.name))
    .slice(0, 15)
    .map(a => ({ name: a.name, path: a.path || '', icon: a.icon || null, isRunning: true }));

  const runningNames = new Set(running.map(a => a.name.toLowerCase()));

  const installed = installedApps
    .filter(a => a.name && !isBrowser(a.name) && !runningNames.has(a.name.toLowerCase()))
    .slice(0, 20)
    .map(a => ({ name: a.name, path: a.path || '', icon: a.icon || null, isRunning: false }));

  return { running, installed };
}

// ── Tool 3: Folder/project detector ──────────────────────────────────────────
// Parses editor window titles to find open project folders

const EDITOR_PATTERNS = {
  vscode:    ['visual studio code', 'code.exe', '\\code\\'],
  cursor:    ['cursor'],
  windsurf:  ['windsurf'],
  idea:      ['intellij idea'],
  webstorm:  ['webstorm'],
  pycharm:   ['pycharm'],
  sublime:   ['sublime text'],
  vim:       ['neovim', 'nvim', 'vim'],
};

function detectOpenProjects(runningApps = []) {
  const projects = [];
  const seen = new Set();

  for (const app of runningApps) {
    const nameLower = (app.name || '').toLowerCase();
    const pathLower = (app.path || '').toLowerCase();

    let editorKey = null;
    for (const [key, patterns] of Object.entries(EDITOR_PATTERNS)) {
      if (patterns.some(p => nameLower.includes(p) || pathLower.includes(p))) {
        editorKey = key;
        break;
      }
    }
    if (!editorKey) continue;

    // VS Code / Cursor title format: "filename — projectName — AppName"
    // or: "projectName (Workspace) — AppName"
    const title = app.title || '';
    const parts = title.split(/\s[—–-]\s/);

    let projectName = null;
    if (parts.length >= 3) {
      // "file — project — AppName" → project is parts[1]
      projectName = parts[parts.length - 2];
    } else if (parts.length === 2) {
      // "project — AppName" → project is parts[0]
      projectName = parts[0];
    }

    if (projectName) {
      projectName = projectName
        .replace(/\s*\(Workspace\).*$/, '')
        .replace(/^\s*[●•]\s*/, '')
        .trim();
    }

    if (projectName && projectName.length > 0 && projectName.length < 60 && !seen.has(projectName.toLowerCase())) {
      seen.add(projectName.toLowerCase());
      projects.push({
        name: projectName,
        editor: editorKey,
        editorName: app.name,
        appPath: app.path || '',
        appIcon: app.icon || null
      });
    }
  }

  return projects;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildAgentPrompt(customPrompt, urlItems, appData, openProjects, syncContext, memoryContext) {
  const contextBlock = syncContext
    ? `User context:\n${syncContext}\n\n`
    : memoryContext
    ? `Context: ${memoryContext}\n\n`
    : '';

  const tabLines = urlItems
    .filter(u => u.source === 'tab')
    .map(u => `${u.tabIndex}. ${u.title} (${u.domain})`)
    .join('\n') || '(none open)';

  const historyLines = urlItems
    .filter(u => u.source === 'history')
    .slice(0, 12)
    .map(u => `- ${u.title} (${u.domain})`)
    .join('\n') || '(none)';

  const bookmarkLines = urlItems
    .filter(u => u.source === 'bookmark')
    .map(u => `- ${u.title} (${u.domain})`)
    .join('\n') || '(none)';

  const runningLines = appData.running.map(a => `- ${a.name}`).join('\n') || '(none)';
  const installedSample = appData.installed.slice(0, 15).map(a => a.name).join(', ') || '(none)';

  const projectLines = openProjects.length > 0
    ? openProjects.map(p => `- "${p.name}" open in ${p.editorName}`).join('\n')
    : '(none detected)';

  const task = customPrompt
    ? `User request: "${customPrompt}"\n\nUsing the data below, create 2-4 workspaces matching the user's intent.`
    : 'Analyse the data below and create 2-4 smart workspaces based on the user\'s current activity.';

  return `${contextBlock}${task}

OPEN BROWSER TABS (use tab numbers in tabItems):
${tabLines}

RECENT HISTORY:
${historyLines}

BOOKMARKS:
${bookmarkLines}

RUNNING DESKTOP APPS:
${runningLines}

INSTALLED APPS:
${installedSample}

OPEN PROJECTS IN EDITORS:
${projectLines}

Rules:
- "tabItems": numbers from OPEN BROWSER TABS only (e.g. [1, 3])
- "apps": app names from RUNNING or INSTALLED lists — only tools relevant to that workspace (no browsers)
- "folders": project names from OPEN PROJECTS — only if the project fits the workspace
- "suggestedUrls": 2-4 URLs not already in tabs that would be useful for this workspace

Return JSON only — no explanation:
{"groups":[{"name":"Workspace Name","description":"Short description","tabItems":[1,2],"apps":["VS Code","Slack"],"folders":[{"name":"myproject","editor":"vscode"}],"suggestedUrls":[{"url":"https://example.com","title":"Example","reason":"Why it fits"}]}]}`;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWorkspaceAgent() {
  /**
   * Run the three-tool agent and return enriched workspace suggestions.
   * Each suggestion includes tabItems, suggestedUrls, apps, and folders.
   */
  const suggestWorkspaces = useCallback(async ({
    tabs = [],
    history = [],
    bookmarks = [],
    runningApps = [],
    installedApps = [],
    customPrompt = '',
    syncContext = '',
    memoryContext = ''
  }) => {
    const chatFn = await resolveChatFn();
    if (!chatFn) {
      throw new Error('AI not available. Configure a cloud AI key in Settings, or load a local model.');
    }

    // Collect data from all three tools (synchronous transforms)
    const urlItems      = collectUrlData(tabs, history, bookmarks);
    const appData       = collectAppData(runningApps, installedApps);
    const openProjects  = detectOpenProjects(runningApps);

    const prompt = buildAgentPrompt(customPrompt, urlItems, appData, openProjects, syncContext, memoryContext);
    console.log('[WorkspaceAgent] Sending agent prompt, urlItems:', urlItems.length, 'apps:', appData.running.length + appData.installed.length, 'projects:', openProjects.length);

    const result = await chatFn(prompt);
    if (!result.ok) throw new Error(result.error || 'AI agent request failed');

    const response = result.response || '';
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch { return []; }

    // Attach collected data to each group so resolveAcceptedGroup can use it
    return (parsed.groups || []).map(g => ({
      ...g,
      items: g.tabItems || g.items || [], // normalise for legacy AISuggestionPanel
      _urlItems: urlItems,
      _appData: appData,
      _openProjects: openProjects
    }));
  }, []);

  /**
   * Convert an accepted suggestion group into concrete workspace data.
   * Returns { urls: [...], apps: [...] } ready to set as formData.
   */
  const resolveAcceptedGroup = useCallback((group) => {
    const urlItems     = group._urlItems     || [];
    const appData      = group._appData      || { running: [], installed: [] };
    const openProjects = group._openProjects || [];

    // ── URLs ─────────────────────────────────────────────────────────────────
    const tabUrls = (group.items || [])
      .map(idx => urlItems.find(u => u.tabIndex === idx))
      .filter(Boolean)
      .map(u => ({ url: u.url, title: u.title, favicon: u.favicon || null, addedAt: Date.now() }));

    const suggestedUrls = (group.suggestedUrls || [])
      .filter(su => su.url)
      .map(su => ({ url: su.url, title: su.title || safeGetHostname(su.url), favicon: null, addedAt: Date.now() }));

    const urlSet = new Set(tabUrls.map(u => u.url));
    const allUrls = [...tabUrls];
    suggestedUrls.forEach(su => {
      if (!urlSet.has(su.url)) { allUrls.push(su); urlSet.add(su.url); }
    });

    // ── Apps ──────────────────────────────────────────────────────────────────
    const allKnownApps = [...appData.running, ...appData.installed];
    const groupApps = (group.apps || [])
      .map(appName => {
        const a = allKnownApps.find(x => x.name.toLowerCase() === appName.toLowerCase())
               || allKnownApps.find(x => x.name.toLowerCase().includes(appName.toLowerCase()))
               || allKnownApps.find(x => appName.toLowerCase().includes(x.name.toLowerCase()));
        if (!a) return null;
        return { name: a.name, path: a.path, icon: a.icon, appType: 'default' };
      })
      .filter(Boolean);

    // ── Folders (project slots — path needs user confirmation) ────────────────
    const folderApps = (group.folders || [])
      .map(f => {
        const proj = openProjects.find(p => p.name.toLowerCase() === f.name.toLowerCase());
        return {
          name: f.name,
          path: proj ? proj.appPath : '',
          icon: proj ? proj.appIcon : null,
          appType: f.editor || 'folder',
          _needsPath: true  // flag for UI to prompt user to confirm path
        };
      });

    return { urls: allUrls, apps: [...groupApps, ...folderApps] };
  }, []);

  return { suggestWorkspaces, resolveAcceptedGroup };
}
