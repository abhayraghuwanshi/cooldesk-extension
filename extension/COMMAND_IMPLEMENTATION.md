# CoolDesk Command Center - Implementation Guide

This document maps the features from `commandcenter.md` to the current implementation in `voiceCommandProcessor.js` and provides a roadmap for missing features.

---

## 🎯 Implementation Status Overview

| Category | Implemented | Partially Done | Not Started | Total |
|----------|-------------|----------------|-------------|-------|
| Core Navigation | 3 | 2 | 2 | 7 |
| Workspace | 1 | 1 | 5 | 7 |
| AI Commands | 0 | 1 | 7 | 8 |
| Bonus Features | 0 | 0 | 8 | 8 |
| **TOTAL** | **4** | **4** | **22** | **30** |

---

## 🔥 1. Core Navigation Commands

### ✅ IMPLEMENTED

#### `!jump <keyword>` *(Implemented as voice: "go to [tab]")*
- **Current Implementation**: `findTabByName()` in voiceCommandProcessor.js
- **Features**:
  - Fuzzy search across tab titles and URLs
  - Threshold: 0.3 for best match
  - Auto-switches to matching tab
  - Provides suggestions if no exact match
- **Voice Commands**:
  - "go to [keyword]"
  - "switch to [keyword]"
  - "find tab [keyword]"

#### `!back` *(Implemented as voice: "go back")*
- **Current Implementation**: `goBack()` in voiceCommandProcessor.js
- **Features**: Uses `window.history.back()`
- **Voice Commands**: "go back", "back"

#### `!go <app>` *(Implemented as voice: "open [site]")*
- **Current Implementation**: `openWebsiteByName()` in voiceCommandProcessor.js
- **Supported Shortcuts**:
  - Gmail: "open gmail"
  - Calendar: "open calendar"
  - YouTube: "open youtube"
  - Facebook, Twitter, Instagram, LinkedIn
  - GitHub, StackOverflow, Reddit, Wikipedia
  - Amazon, Netflix, Spotify
  - Discord, Slack, Zoom
  - Cricbuzz
- **Features**:
  - Direct URL mapping
  - Fallback to Google search if unknown
  - Punctuation handling from speech recognition

### 🟡 PARTIALLY IMPLEMENTED

#### `!history <keyword>` *(Not command-based yet)*
- **Current Status**: History search exists but not via command
- **TODO**: Add `!history` command parser
- **Implementation**:
  ```javascript
  // In SearchPanel.jsx - needs command integration
  else if (command.startsWith('!history ')) {
    const query = command.slice(9).trim();
    // Search history and display results
  }
  ```

#### `!recent` *(Partially via CurrentTabsSection)*
- **Current Status**: Recently closed tabs UI exists
- **TODO**: Add command to show recent tabs
- **Implementation**: Integrate with chrome.sessions API

### ❌ NOT STARTED

#### `!spot <anything>` (Universal Spotlight)
- **Description**: Search across tabs, bookmarks, history, workspaces, commands
- **Priority**: 🔥 HIGH - This is the signature feature
- **Implementation Plan**:
  ```javascript
  async performUniversalSearch(query) {
    const results = {
      tabs: await this.searchTabs(query),
      history: await this.searchHistory(query),
      bookmarks: await this.searchBookmarks(query),
      workspaces: await this.searchWorkspaces(query),
      commands: await this.searchCommands(query)
    };

    // Combine and rank results using fuzzy search
    const ranked = this.rankResults(results, query);
    return ranked;
  }
  ```

---

## 💼 2. Workspace Commands

### ✅ IMPLEMENTED

#### `!ws switch <name>` *(Via UI, not command)*
- **Current Status**: Workspace switching exists in App.jsx
- **TODO**: Add command parser for `!ws switch`

### 🟡 PARTIALLY IMPLEMENTED

#### `!save` *(Partially as "save url to workspace")*
- **Current Implementation**: `saveUrlToWorkspace()` saves current tab
- **Voice Command**: "save url to workspace"
- **TODO**: Extend to save ALL open tabs

### ❌ NOT STARTED

#### `!session restore`
- **Description**: Restore last autosaved session
- **Priority**: 🔥 HIGH
- **Implementation**:
  ```javascript
  async restoreSession() {
    const session = await getUIState().lastSession;
    if (session) {
      await Promise.all(session.tabs.map(tab =>
        chrome.tabs.create({ url: tab.url })
      ));
    }
  }
  ```

#### `!snapshot`
- **Description**: Capture full browser state (tabs, pins, notes, tasks)
- **Priority**: 🔥 VERY HIGH - Viral feature
- **Implementation**:
  ```javascript
  async createSnapshot() {
    const tabs = await chrome.tabs.query({});
    const pinnedWorkspaces = await storageGet('pinnedWorkspaces');
    const notes = await listNotes();

    const snapshot = {
      id: `snapshot_${Date.now()}`,
      timestamp: Date.now(),
      tabs: tabs.map(t => ({ url: t.url, title: t.title, pinned: t.pinned })),
      pinnedWorkspaces,
      notes,
      workspace: currentWorkspace
    };

    await saveSnapshot(snapshot);
  }
  ```

#### `!ws create <name>`
- **Priority**: MEDIUM
- **Implementation**: Use existing `createWorkspace()` from App.jsx

#### `!ws share <email/team>`
- **Priority**: LOW
- **Implementation**: Integrate with SharedWorkspace service

#### `!ws clean`
- **Description**: Close unused/duplicate tabs intelligently
- **Priority**: MEDIUM
- **Implementation**: Extend existing tab cleanup logic

#### `!ws focus`
- **Description**: Close all tabs except work set
- **Priority**: MEDIUM
- **Implementation**: Define "work set" criteria and close others

---

## 🤖 3. AI Commands (CRITICAL FOR VIRALITY)

### 🟡 PARTIALLY IMPLEMENTED

#### `!write <text>` *(Implemented as "add note")*
- **Current Implementation**: `addNote()` saves notes
- **Voice Command**: "add note [text]"
- **TODO**: Add AI enhancement to improve/format the note

### ❌ NOT STARTED - HIGH PRIORITY

These AI commands will make CoolDesk viral. Priority order:

#### 1. `!answer <question>` 🔥🔥🔥
- **Description**: AI reads current tab and answers questions
- **Priority**: CRITICAL - Most powerful feature
- **Implementation**:
  ```javascript
  async answerFromPage(question) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Extract page content
    const pageContent = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText
    });

    // Call AI API (Gemini)
    const answer = await callGeminiAPI({
      context: pageContent[0].result,
      question: question,
      prompt: "Answer based on the page content"
    });

    this.showFeedback(answer);
    voiceResponse.speak(answer);
  }
  ```

#### 2. `!summarize-page` 🔥🔥🔥
- **Priority**: CRITICAL
- **Implementation**:
  ```javascript
  async summarizePage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const content = await extractPageContent(tab.id);

    const summary = await callGeminiAPI({
      content: content,
      prompt: "Provide a concise 3-4 sentence summary of this content"
    });

    // Show in overlay panel
    this.displaySummaryPanel(summary);
  }
  ```

#### 3. `!explain-page` 🔥🔥
- **Priority**: HIGH
- **Implementation**: Similar to summarize but with detailed explanation

#### 4. `!solve <problem>` 🔥🔥
- **Priority**: HIGH
- **Implementation**: Open side panel with AI assistant

#### 5. `!improve <selected text>` 🔥
- **Priority**: MEDIUM
- **Implementation**:
  ```javascript
  async improveText(text) {
    const improved = await callGeminiAPI({
      text: text,
      prompt: "Improve this text for clarity and grammar"
    });

    // Replace selected text
    await replaceSelectedText(improved);
  }
  ```

#### 6. `!meeting-notes`
- **Priority**: MEDIUM
- **Implementation**: Detect Google Meet tab, extract info, generate summary

---

## 🌟 4. Bonus: Viral-Level Commands

### ❌ ALL NOT STARTED

#### `!?` (Command Palette)
- **Description**: Show everything CoolDesk can do
- **Priority**: HIGH
- **Implementation**: Create command palette UI with fuzzy search

#### `!magic` 🔥🔥🔥
- **Description**: AI guesses what user wants based on recent actions
- **Priority**: VERY HIGH - People will FREAK OUT
- **Implementation**:
  ```javascript
  async magicCommand() {
    const tabs = await chrome.tabs.query({});
    const recentHistory = await chrome.history.search({ text: '', maxResults: 50 });

    // Analyze patterns
    const context = analyzeUserContext(tabs, recentHistory);

    // AI suggests relevant commands
    const suggestions = await callGeminiAPI({
      context: context,
      prompt: "Suggest 3 helpful commands based on user activity"
    });

    this.displayMagicSuggestions(suggestions);
  }
  ```

#### `!flow record` / `!flow run <name>`
- **Description**: Record and replay action workflows
- **Priority**: HIGH
- **Implementation**: Mini-Zapier functionality

#### Voice Commands
- `!voice transcribe`
- `!voice command`
- Already have voice input infrastructure

#### Life Commands
- `!weather`
- `!news ai`
- `!stocks <symbol>`
- **Priority**: LOW - Nice to have

---

## 📋 Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Goal**: Polish existing features and add command parsing

1. ✅ Add command parser infrastructure
   ```javascript
   parseCommand(input) {
     if (input.startsWith('!')) {
       const [cmd, ...args] = input.slice(1).split(' ');
       return { command: cmd, args: args.join(' ') };
     }
     return null;
   }
   ```

2. ✅ Implement `!spot` (Universal Spotlight)
3. ✅ Add `!ws switch`, `!ws create` command support
4. ✅ Implement `!history` and `!recent` commands

### Phase 2: AI Integration (Week 3-4)
**Goal**: Add viral AI features

1. 🤖 Integrate Gemini API
2. 🤖 Implement `!answer`
3. 🤖 Implement `!summarize-page`
4. 🤖 Implement `!explain-page`
5. 🤖 Implement `!solve`

### Phase 3: Viral Features (Week 5-6)
**Goal**: Add WOW features

1. 🔮 Implement `!magic` (AI context suggestions)
2. 🔮 Implement `!snapshot`
3. 🔮 Implement `!session restore`
4. 🔮 Add `!?` command palette

### Phase 4: Advanced (Week 7-8)
**Goal**: Workflows and polish

1. ⚡ Implement `!flow record` / `!flow run`
2. ⚡ Add `!ws clean` and `!ws focus`
3. ⚡ Polish UI/UX for all commands
4. ⚡ Add keyboard shortcuts for commands

---

## 🛠️ Technical Integration Points

### 1. Command Parser Location
**File**: `src/services/commandParser.js` (NEW)
```javascript
export class CommandParser {
  static parse(input) {
    if (!input.startsWith('!')) return null;

    const [cmd, ...args] = input.slice(1).split(' ');
    return {
      command: cmd,
      args: args.join(' '),
      fullCommand: input
    };
  }

  static isCommand(input) {
    return input.trim().startsWith('!');
  }
}
```

### 2. Integration with SearchPanel
**File**: `src/components/default/SearchPanel.jsx`
```javascript
const handleSearch = async (e) => {
  e.preventDefault();

  // Check if it's a command
  if (CommandParser.isCommand(search)) {
    await executeCommand(search);
    return;
  }

  // Regular search...
};
```

### 3. AI Service Integration
**File**: `src/services/aiService.js` (NEW)
```javascript
export class AIService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async query(prompt, context = '') {
    const response = await fetch(`${this.baseUrl}/models/gemini-pro:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `${context}\n\n${prompt}` }]
        }]
      })
    });

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }
}
```

### 4. Command Executor
**File**: `src/services/commandExecutor.js` (NEW)
```javascript
export class CommandExecutor {
  constructor() {
    this.commands = new Map();
    this.registerDefaultCommands();
  }

  register(command, handler) {
    this.commands.set(command, handler);
  }

  async execute(parsedCommand) {
    const handler = this.commands.get(parsedCommand.command);
    if (handler) {
      return await handler(parsedCommand.args);
    }
    throw new Error(`Unknown command: !${parsedCommand.command}`);
  }
}
```

---

## 📊 Success Metrics

After implementation, track:
1. **Command Usage**: Which commands are most popular
2. **AI Query Success Rate**: % of useful AI responses
3. **User Retention**: Do users come back for commands?
4. **Viral Coefficient**: Do users share CoolDesk because of commands?

---

## 🎯 MVP Feature Set (Launch-Ready)

For initial launch, prioritize these 15 commands:

### Core (5)
1. ✅ `!jump <tab>`
2. ✅ `!go <shortcut>`
3. ✅ `!back`
4. ❌ `!spot <query>` (Universal search)
5. ❌ `!?` (Command palette)

### Workspace (5)
6. ✅ `!ws switch <name>`
7. ❌ `!save` (all tabs)
8. ❌ `!snapshot`
9. ❌ `!session restore`
10. ❌ `!ws clean`

### AI (5)
11. ❌ `!answer <question>`
12. ❌ `!summarize-page`
13. ❌ `!explain-page`
14. ✅ `!write <note>`
15. ❌ `!magic`

**Launch Status**: 4/15 completed (26%)

---

## 🔗 Related Files

- **Voice Processing**: `src/services/voiceCommandProcessor.js`
- **Fuzzy Search**: `src/utils/searchUtils.js`
- **Workspace Management**: `src/db/index.js`
- **Search Panel**: `src/components/default/SearchPanel.jsx`
- **Settings**: `src/components/popups/SettingsModal.jsx`

---

## 💡 Implementation Tips

1. **Start with Command Parser**: Create the infrastructure first
2. **Use Existing Fuzzy Search**: Already works well for tab/workspace matching
3. **AI Integration**: Use Gemini API (already have apiKey in settings)
4. **Voice Response**: Use existing `voiceResponse.js` for feedback
5. **Error Handling**: Always provide helpful error messages
6. **Testing**: Test each command with various phrasings
7. **Documentation**: Update user-facing docs as you implement

---

## 🚀 Quick Start for Developers

### 1. Implement a New Command

```javascript
// 1. Add to commandParser.js
export const COMMANDS = {
  SPOT: 'spot',
  MAGIC: 'magic',
  SNAPSHOT: 'snapshot',
  // ...
};

// 2. Add handler in commandExecutor.js
register(COMMANDS.SPOT, async (query) => {
  const results = await universalSearch(query);
  displayResults(results);
});

// 3. Add to SearchPanel.jsx
if (CommandParser.isCommand(search)) {
  const parsed = CommandParser.parse(search);
  await commandExecutor.execute(parsed);
}
```

### 2. Test Command

```javascript
// In browser console
const parser = new CommandParser();
const parsed = parser.parse('!spot react hooks');
console.log(parsed); // { command: 'spot', args: 'react hooks' }
```

---

## 📝 Notes

- Voice commands already work well with fuzzy matching
- Search functionality is solid foundation
- Main gap is AI integration (high impact, high effort)
- Command syntax (`!cmd`) will feel native to power users
- Ensure all commands work with both keyboard and voice
- Mobile support consideration for future

---

**Last Updated**: 2025-01-27
**Status**: Foundation Strong, AI Features Pending
**Next Sprint**: Implement Phase 1 (Universal Spotlight + Command Parser)
