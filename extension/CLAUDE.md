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
- `src/components/toolbar/Header.jsx` - Horizontal header for wide screens (≥1200px)
- `src/components/toolbar/VerticalHeader.jsx` - Responsive vertical sidebar with unified theming
- `src/db/index.js` - Unified database API for all storage operations
- `src/utils/GenericUrlParser.js` - URL parsing and workspace auto-creation (1200+ lines)
- `src/data/personas.js` - Persona-based workspace templates

### Important Patterns
- **Message Handler Exclusions**: Check `src/background/activity.js` lines 529-534
- **Chrome Runtime Error Handling**: Always wrap sendMessage calls with chrome.runtime.lastError
- **Side Panel Opening**: Use simple `chrome.sidePanel.open({ windowId })` approach
- **Storage Keys**: Follow existing patterns in storage key naming
- **Responsive Headers**: Auto-switch Header/VerticalHeader at 1200px width breakpoint
- **CSS Theming**: Use CSS variables (--glass-bg, --border-color, --text-primary) with fallbacks

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