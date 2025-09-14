# 🚨 WORKING FEATURES - DO NOT MODIFY

## Critical Working Functionality

### ✅ Side Panel Opening (FIXED - DO NOT CHANGE)
**Files:** `src/background/background.js` (lines 715-733)
**Status:** WORKING as of 2025-01-12

**What works:**
- Footer bar button opens side panel correctly
- Extension icon opens side panel correctly
- Simple direct approach: `chrome.sidePanel.open({ windowId })`

**⚠️ DO NOT:**
- Add `chrome.sidePanel.setOptions()` calls before opening
- Modify the `openSidePanel` message handler
- Change the activity handler exclusion list for `openSidePanel`

**Key code pattern that works:**
```javascript
await chrome.sidePanel.open({ windowId });
```

### ✅ Text Selection to Daily Notes (FIXED - DO NOT CHANGE) 
**Files:** `src/contentInteractions.js`, `src/background/activity.js`
**Status:** WORKING as of 2025-01-12

**What works:**
- Selected text automatically saves to daily notes
- Activity handler properly excludes text selection messages

**⚠️ DO NOT:**
- Remove `textSelected`/`textDeselected` from activity handler exclusions
- Modify the text selection event handlers in contentInteractions.js
- Change the message routing for daily notes

### ✅ Daily Notes Component (FIXED - DO NOT CHANGE)
**Files:** `src/components/default/DailyNotesSection.jsx`
**Status:** WORKING as of 2025-01-12

**What works:**
- Proper Chrome runtime error handling
- Message port errors resolved
- Auto-loading and real-time updates

**⚠️ DO NOT:**
- Remove chrome.runtime.lastError handling
- Change the Promise wrapper patterns for sendMessage calls

### ✅ Workspace Management (WORKING - DO NOT CHANGE)
**Files:** `src/background/workspaces.js`, `src/db/index.js`, workspace components
**Status:** WORKING as of 2025-01-12

**What works:**
- Workspace creation, editing, deletion
- URL-to-workspace associations
- Host application synchronization (Electron app integration)
- Real-time UI updates via BroadcastChannel
- One-time data backfill to host application

**⚠️ DO NOT:**
- Modify workspace DB API functions without understanding impact
- Change host sync functions (setHostWorkspaces, setHostUrls)
- Remove BroadcastChannel usage for real-time updates
- Modify storage keys for workspaces or workspace relationships
- Change the one-time backfill logic in workspaces.js

### ✅ Responsive Header/Sidebar System (WORKING - DO NOT CHANGE)
**Files:** `src/App.jsx`, `src/components/toolbar/Header.jsx`, `src/components/toolbar/VerticalHeader.jsx`, `src/App.css`, `src/index.css`
**Status:** WORKING as of 2025-01-12

**What works:**
- Responsive switching between horizontal Header and vertical VerticalHeader based on screen width
- Auto-collapse VerticalHeader at widths < 1200px (60px collapsed, 280px expanded)
- User preference override to force vertical layout at any screen size
- Unified theming system using CSS variables (--glass-bg, --border-color, --text-primary, etc.)
- Feature parity between both components (search, voice navigation, music controls, buttons)
- Smooth transitions and proper content margin adjustments
- VoiceNavigation integration with proper positioning in both layouts

**Critical working parts - DO NOT MODIFY:**
- Window resize detection logic in App.jsx (lines 114-122)
- Conditional rendering logic in App.jsx (lines 1547-1578)
- CSS variable theming system in both Header components
- CSS classes: `.header.ai-header` and `.vertical-sidebar.ai-sidebar`
- Props passing consistency between Header and VerticalHeader
- Removed conflicting CSS media queries from index.css

**⚠️ DO NOT:**
- Modify responsive breakpoint logic (1200px threshold)
- Change CSS variable naming convention or fallback values
- Remove theme classes from either component
- Add conflicting CSS media queries that hide/transform components
- Modify VoiceNavigation positioning calculations
- Change component prop interfaces without updating both Header variants

### ✅ Voice Navigation Feature (WORKING - DO NOT CHANGE)
**Files:** `src/services/voiceCommandProcessor.js`, `src/components/toolbar/VoiceNavigation.jsx`
**Status:** WORKING as of 2025-01-12

**What works:**
- Speech recognition with continuous listening
- Tab management (switch, close, create, duplicate, reload)
- Window management (new window, close window)
- Web search across multiple engines (Google, YouTube, Perplexity, ChatGPT)
- Website navigation with smart tab finding
- Link clicking with intelligent element matching
- Numbered element clicking with visual overlays
- Page interaction (scroll, back, forward)
- Content mode for reading text elements
- Real-time element number positioning with scroll tracking
- Theme-aware UI that adapts to extension themes
- Collapsible interface with compact controls

**Core Functionality:**
- **Voice Commands**: 50+ voice command patterns for browser control
- **Element Numbering**: Smart element detection with 20+ selectors
- **Tab Management**: Switch by index, name, or search with fuzzy matching
- **Content Reading**: Text-to-speech for numbered content elements
- **Page Interaction**: Scroll tracking, mutation observer for dynamic content
- **Search Integration**: Multi-engine search with customizable patterns

**⚠️ DO NOT:**
- Modify voice command patterns without testing all variations
- Change element selection criteria (may break numbered clicking)
- Remove scroll event handlers or mutation observers
- Alter speech recognition configuration
- Change theme color mapping system
- Modify numbered element positioning logic
- Remove Chrome scripting API calls or error handling

**Key Dependencies:**
- Chrome scripting API for page interaction
- Chrome tabs API for tab management
- Web Speech Recognition API
- Chrome windows API for window management
- Page injection scripts for element interaction

### ✅ Grid Components (WORKING - DO NOT CHANGE)
**Files:** `src/components/ProjectGrid.jsx`, `src/components/ItemGrid.jsx`
**Status:** WORKING as of 2025-01-12

**What works:**
- **ProjectGrid**: Hierarchical URL grouping using GenericUrlParser for platform-based organization
- **ItemGrid**: Domain-based URL grouping with workspace associations
- Keyboard navigation with arrow keys (4-column grid layout)
- Filtering system with interactive filter chips
- Time spent tracking integration via Chrome runtime messages
- Focus management and accessibility features
- Real-time workspace filtering and category stats

**Core Functionality:**
- **URL Parsing & Grouping**: GenericUrlParser integration for intelligent platform detection
- **Workspace Integration**: Links items to workspaces with visual indicators
- **Filter System**: Dynamic category chips with item counts
- **Keyboard Navigation**: Full arrow key navigation support
- **Time Tracking**: Integration with background time tracking system
- **Performance**: Memoized computations for large datasets

**⚠️ DO NOT:**
- Modify GenericUrlParser integration logic in ProjectGrid
- Change keyboard navigation key handling or focus management
- Alter time spent fetching patterns or error handling
- Remove memoization from filtering and grouping computations
- Change the 4-column grid layout assumptions in keyboard navigation
- Modify workspace association logic or filtering
- Remove Chrome runtime error handling patterns

**Key Dependencies:**
- GenericUrlParser for platform-based URL categorization
- WorkspaceProject and WorkspaceItem components for rendering
- Chrome runtime API for time tracking data
- Categories data for workspace filtering
- Keyboard event handling for navigation

### ✅ Pins/Pings Section (WORKING - DO NOT CHANGE)
**Files:** `src/components/default/PingsSection.jsx`
**Status:** WORKING as of 2025-01-12

**What works:**
- Pin/bookmark management with persistent storage
- Real-time updates via database subscription system  
- Smart tab detection and focusing (switch to existing tab vs create new)
- Favicon handling with multiple fallback strategies
- Cross-platform support (Chrome extension + Electron integration)
- Visual feedback with hover effects and smooth animations
- Automatic pin limit (shows max 6 pins) with count display

**Core Functionality:**
- **Pin Creation**: Add current tab as pin with title, favicon, timestamp
- **Pin Management**: Remove pins with confirmation UI
- **Smart Navigation**: Opens existing tab or creates new one intelligently  
- **Real-time Sync**: subscribePinsChanges() for live updates across components
- **Database Integration**: Full CRUD operations via unified DB API
- **Favicon Management**: Multi-strategy favicon loading with error handling

**⚠️ DO NOT:**
- Modify database subscription patterns or real-time update system
- Change tab focusing/creation logic (Chrome vs Electron handling)
- Alter favicon fallback strategies or error handling
- Remove Chrome runtime error checking patterns
- Modify pin limit (6 pins) or display logic
- Change the URL matching logic for existing tab detection
- Remove extensionApi integration for Electron compatibility

**Key Dependencies:**
- Database API (dbListPings, dbUpsertPing, dbDeletePing, subscribePinsChanges)
- Chrome tabs API for tab management and focusing
- Extension API bridge for Electron integration
- FontAwesome icons for UI elements
- URL parsing and favicon utilities

### ✅ Notes Section with Voice Features (WORKING BUT NEEDS UX IMPROVEMENTS)
**Files:** `src/components/default/NotesSection.jsx`
**Status:** WORKING as of 2025-01-12 (but has UX complexity issues)

**What works:**
- Text note creation with status management (Todo, In Progress, Done)
- Voice recording with audio storage and playback
- Speech-to-text with real-time transcription
- Hybrid voice+text notes with dual recording system
- Inline editing with auto-resize textarea
- Notes display limit with show/hide functionality
- Status dropdown with visual indicators and color coding

**Current UX Issues:**
- **Dual Button Confusion**: Both Save and Microphone buttons create duplicate functionality
- **Recording Complexity**: Two separate recording systems (voice-only vs speech-to-text)
- **Auto-save vs Manual**: Speech-to-text auto-saves but manual entry requires Save button
- **Button State Overlap**: Microphone pause/stop states conflict with text input flow

**Core Functionality:**
- **Text Notes**: Manual text entry with status tracking
- **Voice Notes**: Audio recording with base64 storage and playback
- **Hybrid Notes**: Speech-to-text with audio backup (dual recording)
- **Status Management**: Todo/In Progress/Done workflow with visual indicators
- **Real-time Features**: Auto-resize text areas, live character count, recording timer

**⚠️ DO NOT:**
- Remove speech recognition integration without providing alternative
- Change database API integration patterns (dbUpsertNote, dbDeleteNote, dbListNotes)
- Modify audio recording base64 storage format (affects playback)
- Remove status management system (affects workflow)
- Change real-time transcription functionality
- Modify MediaRecorder integration or audio processing

**Key Dependencies:**
- Web Speech Recognition API for speech-to-text
- MediaRecorder API for audio recording
- Database API for note persistence  
- FontAwesome icons for status and action indicators
- Base64 encoding for audio data storage

## Message Handler Exclusions (CRITICAL)
**File:** `src/background/activity.js` lines 529-534

These message types MUST be excluded from activity handler:
- `updateDailyNotes`
- `getDailyNotes` 
- `deleteSelection`
- `textSelected`
- `textDeselected`
- `openSidePanel`

## Build Commands That Work
```bash
npm run build  # Always works
```

## Last Updated
2025-01-12 - After fixing side panel and daily notes functionality