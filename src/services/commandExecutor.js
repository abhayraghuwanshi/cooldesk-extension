import { getUIState, listWorkspaces, saveUIState, saveWorkspace } from '../db/index.js';
import { fuzzySearch } from '../utils/searchUtils.js';
import { COMMANDS, CommandParser, WEBSITE_SHORTCUTS } from './commandParser.js';

/**
 * CommandExecutor - Executes parsed commands
 *
 * Central command execution engine that handles all ! commands
 */
export class CommandExecutor {
  constructor(feedbackCallback) {
    this.feedbackCallback = feedbackCallback || ((msg) => console.log(msg));
    this.commands = new Map();
    this.registerDefaultCommands();
  }

  /**
   * Register all default command handlers
   */
  registerDefaultCommands() {
    // Core Navigation
    this.register(COMMANDS.JUMP, this.handleJump.bind(this));
    this.register(COMMANDS.GO, this.handleGo.bind(this));
    this.register(COMMANDS.BACK, this.handleBack.bind(this));
    this.register(COMMANDS.FORWARD, this.handleForward.bind(this));
    this.register(COMMANDS.SPOT, this.handleSpot.bind(this));
    this.register(COMMANDS.HISTORY, this.handleHistory.bind(this));
    this.register(COMMANDS.RECENT, this.handleRecent.bind(this));

    // Workspace
    this.register(COMMANDS.WS, this.handleWorkspace.bind(this));
    this.register(COMMANDS.SAVE, this.handleSave.bind(this));
    this.register(COMMANDS.SNAPSHOT, this.handleSnapshot.bind(this));
    this.register(COMMANDS.SESSION, this.handleSession.bind(this));

    // AI Commands (placeholders for now)
    this.register(COMMANDS.ANSWER, this.handleAnswer.bind(this));
    this.register(COMMANDS.SUMMARIZE, this.handleSummarize.bind(this));
    this.register(COMMANDS.EXPLAIN, this.handleExplain.bind(this));
    this.register(COMMANDS.WRITE, this.handleWrite.bind(this));

    // Special
    this.register(COMMANDS.HELP, this.handleHelp.bind(this));
    this.register(COMMANDS.MAGIC, this.handleMagic.bind(this));
  }

  /**
   * Register a command handler
   */
  register(command, handler) {
    this.commands.set(command, handler);
  }

  /**
   * Execute a parsed command
   */
  async execute(parsed) {
    if (!parsed) {
      throw new Error('Invalid command');
    }

    if (!CommandParser.validate(parsed)) {
      throw new Error(`Command "${parsed.command}" requires arguments`);
    }

    const handler = this.commands.get(parsed.command);
    if (!handler) {
      throw new Error(`Unknown command: !${parsed.command}`);
    }

    try {
      return await handler(parsed);
    } catch (error) {
      console.error(`Error executing command !${parsed.command}:`, error);
      throw error;
    }
  }

  // ==================== COMMAND HANDLERS ====================

  /**
   * !jump <tab> - Jump to open tab
   */
  async handleJump(parsed) {
    const query = parsed.args;
    const tabs = await chrome.tabs.query({});

    const matches = fuzzySearch(tabs, query, ['title', 'url'], {
      threshold: 0.3,
      includeScore: true
    });

    if (matches.length > 0) {
      const best = matches[0];
      await chrome.tabs.update(best.id, { active: true });
      await chrome.windows.update(best.windowId, { focused: true });

      this.feedbackCallback({
        type: 'success',
        message: `Jumped to: ${best.title}`,
        data: { tab: best }
      });

      return { success: true, tab: best };
    } else {
      throw new Error(`No tab found matching "${query}"`);
    }
  }

  /**
   * !go <shortcut> - Open website by shortcut
   */
  async handleGo(parsed) {
    const shortcut = parsed.args.toLowerCase();
    const url = WEBSITE_SHORTCUTS[shortcut];

    if (!url) {
      // Try as direct URL
      const directUrl = shortcut.includes('.') ? `https://${shortcut}` : null;
      if (directUrl) {
        await chrome.tabs.create({ url: directUrl });
        this.feedbackCallback({
          type: 'success',
          message: `Opened: ${shortcut}`
        });
        return { success: true, url: directUrl };
      }

      const available = Object.keys(WEBSITE_SHORTCUTS).join(', ');
      throw new Error(`Unknown shortcut "${shortcut}". Available: ${available}`);
    }

    await chrome.tabs.create({ url });
    this.feedbackCallback({
      type: 'success',
      message: `Opened: ${shortcut}`
    });

    return { success: true, url };
  }

  /**
   * !back - Go back
   */
  async handleBack(parsed) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.history.back()
    });

    this.feedbackCallback({
      type: 'success',
      message: 'Went back'
    });

    return { success: true };
  }

  /**
   * !forward - Go forward
   */
  async handleForward(parsed) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.history.forward()
    });

    this.feedbackCallback({
      type: 'success',
      message: 'Went forward'
    });

    return { success: true };
  }

  /**
   * !spot <query> - Universal Spotlight search
   * Searches across tabs, history, bookmarks, workspaces
   */
  async handleSpot(parsed) {
    const query = parsed.args;

    // Search tabs
    const tabs = await chrome.tabs.query({});
    const tabMatches = fuzzySearch(tabs, query, ['title', 'url'], { threshold: 0.3 });

    // Search history
    let historyMatches = [];
    try {
      const historyItems = await chrome.history.search({ text: query, maxResults: 10 });
      historyMatches = historyItems.map(h => ({
        ...h,
        type: 'history',
        url: h.url,
        title: h.title || h.url
      }));
    } catch (e) {
      console.warn('History search failed:', e);
    }

    // Search bookmarks
    let bookmarkMatches = [];
    try {
      const bookmarks = await chrome.bookmarks.search(query);
      bookmarkMatches = bookmarks
        .filter(b => b.url)
        .map(b => ({
          ...b,
          type: 'bookmark',
          url: b.url,
          title: b.title || b.url
        }));
    } catch (e) {
      console.warn('Bookmark search failed:', e);
    }

    // Search workspaces
    const workspacesResult = await listWorkspaces();
    const workspaces = workspacesResult?.success ? workspacesResult.data : [];
    const workspaceItems = workspaces.flatMap(ws =>
      (ws.urls || []).map(u => ({
        ...u,
        type: 'workspace',
        workspace: ws.name
      }))
    );
    const workspaceMatches = fuzzySearch(workspaceItems, query, ['title', 'url'], { threshold: 0.3 });

    // Combine all results
    const allResults = [
      ...tabMatches.map(t => ({ ...t, type: 'tab', score: t.score || 1 })),
      ...historyMatches.map(h => ({ ...h, score: 0.8 })),
      ...bookmarkMatches.map(b => ({ ...b, score: 0.9 })),
      ...workspaceMatches.map(w => ({ ...w, score: 0.85 }))
    ];

    // Sort by score
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));

    this.feedbackCallback({
      type: 'spotlight',
      message: `Found ${allResults.length} results for "${query}"`,
      data: {
        results: allResults.slice(0, 20),
        query
      }
    });

    return {
      success: true,
      results: allResults.slice(0, 20),
      count: allResults.length
    };
  }

  /**
   * !history <query> - Search browser history
   */
  async handleHistory(parsed) {
    const query = parsed.args;
    const results = await chrome.history.search({
      text: query,
      maxResults: 20,
      startTime: 0
    });

    this.feedbackCallback({
      type: 'history',
      message: `Found ${results.length} history items`,
      data: { results, query }
    });

    return { success: true, results };
  }

  /**
   * !recent - Show recently closed tabs
   */
  async handleRecent(parsed) {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });

    this.feedbackCallback({
      type: 'recent',
      message: `Found ${sessions.length} recently closed tabs`,
      data: { sessions }
    });

    return { success: true, sessions };
  }

  /**
   * !ws - Workspace commands
   */
  async handleWorkspace(parsed) {
    const { subcommand, args } = parsed;

    switch (subcommand) {
      case 'switch':
        return await this.handleWorkspaceSwitch(args);
      case 'create':
        return await this.handleWorkspaceCreate(args);
      case 'clean':
        return await this.handleWorkspaceClean();
      case 'focus':
        return await this.handleWorkspaceFocus();
      default:
        throw new Error(`Unknown workspace command: ${subcommand}. Try: switch, create, clean, focus`);
    }
  }

  async handleWorkspaceSwitch(name) {
    const workspacesResult = await listWorkspaces();
    const workspaces = workspacesResult?.success ? workspacesResult.data : [];

    const match = fuzzySearch(workspaces, name, ['name'], { threshold: 0.3 });

    if (match.length === 0) {
      throw new Error(`Workspace "${name}" not found`);
    }

    const workspace = match[0];

    // Save to UI state
    await saveUIState({ lastWorkspace: workspace.name });

    this.feedbackCallback({
      type: 'workspace',
      message: `Switched to workspace: ${workspace.name}`,
      data: { workspace }
    });

    return { success: true, workspace };
  }

  async handleWorkspaceCreate(name) {
    const workspace = {
      id: `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name,
      description: '',
      createdAt: Date.now(),
      urls: []
    };

    await saveWorkspace(workspace);

    this.feedbackCallback({
      type: 'workspace',
      message: `Created workspace: ${name}`,
      data: { workspace }
    });

    return { success: true, workspace };
  }

  async handleWorkspaceClean() {
    // Close duplicate and unused tabs
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const urlMap = new Map();
    const toClose = [];

    tabs.forEach(tab => {
      if (!tab.pinned && !tab.active) {
        if (urlMap.has(tab.url)) {
          toClose.push(tab.id);
        } else {
          urlMap.set(tab.url, tab);
        }
      }
    });

    if (toClose.length > 0) {
      await chrome.tabs.remove(toClose);
    }

    this.feedbackCallback({
      type: 'success',
      message: `Cleaned ${toClose.length} duplicate tabs`
    });

    return { success: true, closed: toClose.length };
  }

  async handleWorkspaceFocus() {
    // Close all tabs except pinned and active
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const toClose = tabs.filter(t => !t.pinned && !t.active).map(t => t.id);

    if (toClose.length > 0) {
      await chrome.tabs.remove(toClose);
    }

    this.feedbackCallback({
      type: 'success',
      message: `Focused workspace (closed ${toClose.length} tabs)`
    });

    return { success: true, closed: toClose.length };
  }

  /**
   * !save - Save all tabs to workspace
   */
  async handleSave(parsed) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const uiState = await getUIState();
    const currentWorkspace = uiState?.lastWorkspace;

    if (!currentWorkspace) {
      throw new Error('No active workspace. Switch to a workspace first.');
    }

    const workspacesResult = await listWorkspaces();
    const workspaces = workspacesResult?.success ? workspacesResult.data : [];
    const ws = workspaces.find(w => w.name === currentWorkspace);

    if (!ws) {
      throw new Error(`Workspace "${currentWorkspace}" not found`);
    }

    // Add all tabs to workspace
    const newUrls = tabs.map(t => ({
      url: t.url,
      title: t.title,
      addedAt: Date.now(),
      favicon: t.favIconUrl
    }));

    ws.urls = [...(ws.urls || []), ...newUrls];
    await saveWorkspace(ws);

    this.feedbackCallback({
      type: 'success',
      message: `Saved ${tabs.length} tabs to "${currentWorkspace}"`
    });

    return { success: true, count: tabs.length, workspace: currentWorkspace };
  }

  /**
   * !snapshot - Capture browser state
   */
  async handleSnapshot(parsed) {
    const tabs = await chrome.tabs.query({});
    const uiState = await getUIState();

    const snapshot = {
      id: `snapshot_${Date.now()}`,
      timestamp: Date.now(),
      tabs: tabs.map(t => ({
        url: t.url,
        title: t.title,
        pinned: t.pinned,
        windowId: t.windowId
      })),
      workspace: uiState?.lastWorkspace,
      pinnedWorkspaces: uiState?.pinnedWorkspaces || []
    };

    // Save snapshot to UI state
    const snapshots = uiState?.snapshots || [];
    snapshots.unshift(snapshot);

    await saveUIState({
      ...uiState,
      snapshots: snapshots.slice(0, 10) // Keep last 10
    });

    this.feedbackCallback({
      type: 'success',
      message: `Snapshot saved (${tabs.length} tabs)`
    });

    return { success: true, snapshot };
  }

  /**
   * !session restore - Restore last session
   */
  async handleSession(parsed) {
    const { subcommand } = parsed;

    if (subcommand === 'restore') {
      const uiState = await getUIState();
      const snapshots = uiState?.snapshots || [];

      if (snapshots.length === 0) {
        throw new Error('No saved snapshots found');
      }

      const lastSnapshot = snapshots[0];

      // Restore tabs
      for (const tab of lastSnapshot.tabs) {
        await chrome.tabs.create({ url: tab.url, pinned: tab.pinned });
      }

      this.feedbackCallback({
        type: 'success',
        message: `Restored ${lastSnapshot.tabs.length} tabs from snapshot`
      });

      return { success: true, restored: lastSnapshot.tabs.length };
    } else {
      throw new Error('Unknown session command. Try: !session restore');
    }
  }

  /**
   * AI Command handlers (placeholders - need AI integration)
   */
  async handleAnswer(parsed) {
    this.feedbackCallback({
      type: 'info',
      message: '🤖 AI Answer feature coming soon! Configure Gemini API key in settings.'
    });
    return { success: false, message: 'AI not configured' };
  }

  async handleSummarize(parsed) {
    this.feedbackCallback({
      type: 'info',
      message: '🤖 AI Summarize feature coming soon! Configure Gemini API key in settings.'
    });
    return { success: false, message: 'AI not configured' };
  }

  async handleExplain(parsed) {
    this.feedbackCallback({
      type: 'info',
      message: '🤖 AI Explain feature coming soon! Configure Gemini API key in settings.'
    });
    return { success: false, message: 'AI not configured' };
  }

  async handleWrite(parsed) {
    this.feedbackCallback({
      type: 'info',
      message: '🤖 AI Write feature coming soon! Configure Gemini API key in settings.'
    });
    return { success: false, message: 'AI not configured' };
  }

  /**
   * !? - Show command palette
   */
  async handleHelp(parsed) {
    const commands = CommandParser.getAllCommands();

    this.feedbackCallback({
      type: 'help',
      message: 'Available Commands',
      data: { commands }
    });

    return { success: true, commands };
  }

  /**
   * !magic - AI context-aware suggestions
   */
  async handleMagic(parsed) {
    // Analyze user context
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const recentHistory = await chrome.history.search({ text: '', maxResults: 20 });

    // Simple context analysis (AI would make this smarter)
    const suggestions = [];

    // If user has many tabs, suggest cleanup
    if (tabs.length > 15) {
      suggestions.push({
        command: '!ws clean',
        reason: `You have ${tabs.length} tabs open`
      });
    }

    // If user visits GitHub a lot, suggest it
    const githubCount = tabs.filter(t => t.url?.includes('github.com')).length;
    if (githubCount > 0) {
      suggestions.push({
        command: '!jump github',
        reason: `You have ${githubCount} GitHub tabs`
      });
    }

    this.feedbackCallback({
      type: 'magic',
      message: '✨ Magic suggestions based on your activity',
      data: { suggestions }
    });

    return { success: true, suggestions };
  }
}
