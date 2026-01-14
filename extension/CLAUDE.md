# Claude Code Configuration

## 📋 Always Reference These Files

### Architecture & Working Features
- `FEATURE_ARCHITECTURE.md` - Complete feature architecture and dependencies
- `WORKING_FEATURES.md` - Critical working functionality (DO NOT MODIFY)

### Core Extension Files
- `src/background/background.js` - Main background script with message handlers
- `src/background/activity.js` - Activity tracking and message routing (CRITICAL exclusions)
- `src/contentInteractions.js` - Text selection and content script interactions
- `src/footerBar.js` - Floating button and side panel trigger
- `manifest.json` - Extension permissions and configuration

### Key Components
- `src/components/default/DailyNotesSection.jsx` - Daily notes UI and message handling
- `src/components/default/CurrentTabsSection.jsx` - Tab management with auto-cleanup and recently closed tabs
- `src/components/toolbar/Header.jsx` - Horizontal header for wide screens (≥1200px)
- `src/components/toolbar/VerticalHeader.jsx` - Responsive vertical sidebar with unified theming
- `src/db/index.js` - Unified database API for all storage operations
- `src/utils/GenericUrlParser.js` - URL parsing and workspace auto-creation (1500+ lines with Claude/ChatGPT title handling)
- `src/data/personas.js` - Persona-based workspace templates
- `src/background/tabCleanup.js` - Auto tab cleanup functionality with activity tracking

### Important Patterns
- **Message Handler Exclusions**: Check `src/background/activity.js` lines 529-534
- **Chrome Runtime Error Handling**: Always wrap sendMessage calls with chrome.runtime.lastError
- **Side Panel Opening**: Use simple `chrome.sidePanel.open({ windowId })` approach
- **Storage Keys**: Follow existing patterns in storage key naming
- **Responsive Headers**: Auto-switch Header/VerticalHeader at 1200px width breakpoint
- **CSS Theming**: Use CSS variables (--glass-bg, --border-color, --text-primary) with fallbacks
- **AI Chat Title Handling**: Claude and ChatGPT URLs use sophisticated title extraction from browser history with fallbacks
- **Default Theme**: Crimson Fire theme is set as application default in App.jsx

## ⚠️ Critical Rules
1. NEVER modify activity.js exclusions without understanding impact
2. NEVER add chrome.sidePanel.setOptions() calls (breaks functionality) 
3. ALWAYS check WORKING_FEATURES.md before modifying core files
4. ALWAYS use chrome.runtime.lastError handling in message calls

## 🔧 Build Commands
```bash
npm run build    # Always works
```

## 📁 Project Structure Context
This is a Chrome Extension with:
- Daily Notes auto-capture from text selection
- Side Panel with extension UI
- Workspace management with Electron app sync
- URL parsing and auto-workspace creation
- Activity tracking and analytics
- Multiple content scripts for different functionality
- Auto tab cleanup with configurable settings (20 tab limit, 10min inactive timeout)
- Recently closed tabs restore functionality using chrome.sessions API
- @src\components\toolbar\Header.jsx remove the microphone from here

## 🧹 Tab Management Features
### Auto Cleanup (CurrentTabsSection)
- **Toggle Button**: Broom icon next to reload button (green when enabled)
- **Smart Protection**: Never closes pinned, active, audio/video, or excluded domain tabs
- **Two-Phase Cleanup**: 1) Close tabs inactive >10min, 2) Enforce 20-tab limit by age
- **Background Service**: Uses chrome.alarms for 1-minute interval checks
- **Settings Storage**: Persisted in chrome.storage.local with background sync

### Recently Closed Tabs
- **Toggle Button**: History icon shows/hides recently closed section
- **Chrome Sessions API**: Fetches last 10 closed tabs (requires "sessions" permission)
- **One-Click Restore**: Click any closed tab to restore instantly
- **System Filtering**: Excludes chrome://, edge://, extension tabs
- **Auto-Refresh**: Updates both current and closed tabs after restore actions

### Domain Exclusions
- gmail.com, github.com, localhost, claude.ai, chat.openai.com protected from auto-cleanup