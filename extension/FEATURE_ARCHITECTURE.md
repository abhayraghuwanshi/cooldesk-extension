# 🏗️ Extension Feature Architecture & Dependencies

This document maps out how each feature works, which files are involved, and potential impact areas when making changes.

## 📝 Daily Notes Feature

### How it Works
1. User selects text on any webpage (≥15 characters)
2. Content script detects selection and sends `textSelected` message
3. Background script auto-saves to today's daily notes with timestamp and source
4. Daily Notes component displays auto-captured text with formatting

### Core Files & Their Role
```
📁 Daily Notes Architecture
├── 🎯 src/contentInteractions.js (lines 81-141)
│   └── Detects text selection, sends textSelected messages
│
├── 🎯 src/background/background.js (lines 478-525)
│   └── Receives textSelected, calls saveToDailyNotes()
│   └── saveToDailyNotes() function (lines 18-116)
│
├── 🎯 src/background/activity.js (lines 529-534) 
│   └── CRITICAL: Excludes textSelected/textDeselected from interception
│
├── 🎯 src/components/default/DailyNotesSection.jsx
│   └── UI component for viewing/editing daily notes
│   └── Message handlers: getDailyNotes, updateDailyNotes, deleteSelection
│
└── 🎯 src/db/index.js
    └── subscribeDailyNotesChanges() for real-time updates
```

### Message Flow
```
Text Selection → contentInteractions.js → textSelected message
                                       ↓
Background Script → saveToDailyNotes() → Chrome Storage
                                       ↓
Daily Notes Component ← BroadcastChannel ← Background Script
```

### Dependencies & Impact Areas
- **If you modify** `contentInteractions.js` → affects text selection detection
- **If you modify** `activity.js exclusions` → breaks message routing
- **If you modify** `saveToDailyNotes()` → affects auto-capture functionality
- **If you modify** Chrome storage keys → breaks data persistence

---

## 🎛️ Side Panel Feature

### How it Works
1. Footer bar button sends `openSidePanel` message to background
2. Background script calls `chrome.sidePanel.open({ windowId })`
3. Side panel opens with extension UI

### Core Files & Their Role
```
📁 Side Panel Architecture
├── 🎯 src/footerBar.js (lines 178-253)
│   └── Floating button, sends openSidePanel message
│
├── 🎯 src/background/background.js (lines 706-763)
│   └── openSidePanel message handler
│   └── chrome.sidePanel.open() call (line 721)
│
├── 🎯 src/background/background.js (lines 916-967)
│   └── Extension icon click handler
│
├── 🎯 src/background/activity.js (line 534)
│   └── CRITICAL: Excludes openSidePanel from interception
│
└── 🎯 manifest.json (lines 8-10)
    └── Side panel configuration
```

### Message Flow
```
Footer Button → openSidePanel message → Background Script
                                                    ↓
                              chrome.sidePanel.open() → Side Panel Opens
```

### Dependencies & Impact Areas
- **If you modify** `activity.js exclusions` → breaks message routing  
- **If you modify** side panel handler → affects opening functionality
- **If you modify** manifest side_panel config → breaks side panel setup
- **If you add** `setOptions()` calls → breaks functionality (known issue)

---

## 🔗 URL Notes Feature

### How it Works
1. Users can save notes associated with specific URLs
2. Screenshot capture, text notes, and selected text storage
3. Integration with URL-based note retrieval

### Core Files & Their Role
```
📁 URL Notes Architecture  
├── 🎯 src/background/urlNotesHandler.js
│   └── All URL notes message handlers
│   └── Screenshot capture, note saving, retrieval
│
├── 🎯 src/components/[url-notes-component].jsx
│   └── UI for viewing/editing URL notes
│
└── 🎯 src/db/index.js
    └── saveUrlNote(), getUrlNotes(), deleteUrlNote()
```

### Dependencies & Impact Areas
- **If you modify** `urlNotesHandler.js` → affects all URL notes functionality
- **If you modify** DB functions → affects data persistence
- **If you modify** screenshot permissions → breaks capture feature

---

## 🗂️ Workspace Management Feature

### How it Works
1. Users create workspaces to organize URLs/bookmarks by project or topic
2. URLs can be added to multiple workspaces
3. Workspace data is mirrored to host application for Electron app access
4. Real-time sync with UI updates when workspaces change

### Core Files & Their Role
```
📁 Workspace Management Architecture
├── 🎯 src/background/workspaces.js
│   └── initializeWorkspaces() - one-time data backfill
│   └── Mirror workspaces and URLs to host application
│
├── 🎯 src/db/index.js (Unified DB API)
│   └── listWorkspaces(), getWorkspace(), saveWorkspace()
│   └── deleteWorkspace(), addUrlToWorkspace()
│   └── listWorkspaceUrls(), subscribeWorkspaceChanges()
│
├── 🎯 src/components/settings/WorkspacesTab.jsx
│   └── UI for managing workspaces in settings
│   └── Create, edit, delete workspace functionality
│
├── 🎯 src/components/WorkspaceItem.jsx
│   └── Individual workspace display component
│
├── 🎯 src/components/popups/CreateWorkspaceModal.jsx
│   └── Modal for creating new workspaces
│
├── 🎯 src/components/popups/AddToWorkspaceModal.jsx
│   └── Modal for adding URLs to existing workspaces
│
├── 🎯 src/utils/workspaceControls.js
│   └── Utility functions for workspace operations
│
└── 🎯 src/services/extensionApi.js
    └── setHostWorkspaces(), setHostUrls() - host sync functions
```

### Data Flow
```
User Action → WorkspacesTab/Modals → DB API Functions → Chrome Storage
                                                            ↓
Host Application ← setHostWorkspaces() ← Background Script ← Storage Changes
                                                            ↓
UI Components ← subscribeWorkspaceChanges() ← BroadcastChannel ← DB Changes
```

### Dependencies & Impact Areas
- **If you modify** workspace DB functions → affects all workspace operations
- **If you modify** host sync functions → breaks Electron app integration  
- **If you modify** workspace components → affects workspace UI
- **If you modify** storage keys → breaks workspace data persistence
- **If you modify** BroadcastChannel usage → breaks real-time updates

---

## 🔍 URL Parsing & Auto-Workspace Creation Feature

### How it Works
1. GenericUrlParser analyzes URLs from history/bookmarks to detect platforms (GitHub, ChatGPT, etc.)
2. Automatically groups related URLs by platform or project
3. Creates workspace suggestions based on detected patterns
4. Filters out unwanted URLs (OAuth, login, settings, etc.)
5. App.jsx uses this to auto-create workspaces on startup

### Core Files & Their Role
```
📁 URL Parsing & Auto-Creation Architecture
├── 🎯 src/utils/GenericUrlParser.js (1200+ lines)
│   └── Platform configurations for GitHub, ChatGPT, Claude, Figma, etc.
│   └── URL pattern matching and workspace extraction
│   └── shouldExclude() - filters unwanted URLs (1000+ exclusion patterns)
│   └── createWorkspacesFromUrls() - workspace generation
│   └── Cross-browser history scanning support
│
├── 🎯 src/App.jsx (lines 179-270)
│   └── Auto-workspace creation effect
│   └── Combines platform + category-based workspace creation
│   └── One-time execution with hash-based deduplication
│
├── 🎯 src/data/categories.js
│   └── Category-based URL classification (social, shopping, etc.)
│
└── 🎯 src/utils/realTimeCategorizor.js
    └── Real-time URL categorization as user browses
```

### Platform Support
```
Supported Platforms (9 total):
├── github.com → Groups repos by platform/owner/individual
├── chat.openai.com / chatgpt.com → Groups all chats 
├── claude.ai → Groups conversations
├── gemini.google.com → Groups conversations
├── figma.com → Groups design files
├── perplexity.ai → Groups searches
├── notion.so → Groups pages
├── Various other platforms with custom patterns
└── Category fallback for unsupported domains
```

### URL Exclusion System
```
1000+ Exclusion Patterns Including:
├── OAuth & Authentication URLs
├── Login/logout/signup pages
├── Settings and admin pages
├── API endpoints and callbacks
├── Marketing tracking parameters
├── File downloads and resources
├── Browser internal URLs
├── Development/testing domains
└── Platform-specific noisy URLs
```

### Data Flow
```
Browser History/Bookmarks → GenericUrlParser.parse() → Platform Detection
                                                              ↓
Auto-Workspace Creation ← createWorkspacesFromUrls() ← URL Grouping
                                                              ↓
User's Workspace List ← saveWorkspace() ← Workspace Generation
```

### Dependencies & Impact Areas
- **If you modify** GenericUrlParser config → affects workspace auto-creation for that platform
- **If you modify** exclusion patterns → changes what URLs get processed
- **If you modify** auto-creation logic in App.jsx → affects startup workspace generation
- **If you modify** platform grouping strategies → changes how URLs are organized

---

## 👤 Persona-Based Workspace Templates Feature

### How it Works
1. Pre-defined persona templates (Developer, Designer, Marketer, etc.) 
2. Each persona contains curated workspaces with relevant URLs
3. Users can select a persona to auto-create workspace sets
4. Provides quick setup for different user types and workflows

### Core Files & Their Role
```
📁 Persona Templates Architecture
├── 🎯 src/data/personas.js
│   └── 6 persona definitions with workspaces and URLs
│   └── getPersonaByTitle(), getPersonaTitles() utilities
│   └── validatePersona() for data integrity
│
├── 🎯 src/components/settings/PersonasTab.jsx
│   └── UI for selecting and applying persona templates
│
└── 🎯 src/components/popups/SettingsModal.jsx
    └── Contains PersonasTab in settings interface
```

### Available Personas
```
📋 6 Persona Types:
├── 👨‍💻 Developer (4 workspaces, 29 URLs)
│   └── Development, Cloud & DevOps, Learning, Productivity
├── 🎨 Designer (3 workspaces, 15 URLs) 
│   └── Design & Creativity, Prototyping, Learning
├── 📊 Marketer (4 workspaces, 18 URLs)
│   └── Productivity & AI, Communication, Analytics, Social Media
├── 🎬 Content Creator (3 workspaces, 16 URLs)
│   └── Audio & MP3, Video Editing, Social Media
├── 🎓 Student/Researcher (3 workspaces, 13 URLs)
│   └── Learning & Research, Productivity, Communication  
└── 🌐 General (5 workspaces, 20 URLs)
    └── AI & Productivity, Communication, Social, Tools, Learning
```

### Data Structure
```javascript
persona = {
  icon: FontAwesome icon,
  title: "Persona Name", 
  description: "Who this is for",
  workspaces: [
    {
      name: "Workspace Name",
      description: "What this workspace contains", 
      urls: ["https://...", "https://..."]
    }
  ]
}
```

### Dependencies & Impact Areas
- **If you modify** persona definitions → affects template workspace creation
- **If you modify** PersonasTab UI → affects persona selection experience
- **If you modify** workspace creation from personas → affects template application
- **If you modify** persona validation → affects data integrity checks

---

## 📊 Activity Tracking Feature

### How it Works
1. Content scripts send interaction messages (scroll, click, etc.)
2. Background script processes and stores activity data
3. Time series data collection for analytics

### Core Files & Their Role
```
📁 Activity Tracking Architecture
├── 🎯 src/interactionContent.js
│   └── Sends scroll, click, visibility messages
│
├── 🎯 src/background/activity.js
│   └── handleActivityContentScriptMessage() - processes activity
│   └── Activity data accumulation and storage
│
└── 🎯 src/background/background.js
    └── Activity message routing and cleanup
```

### Dependencies & Impact Areas
- **If you modify** message exclusions → breaks other features
- **If you modify** activity handlers → affects analytics
- **If you modify** time series cleanup → affects storage management

---

## ⚡ Content Script Injection

### How it Works  
1. Extension injects content scripts into web pages
2. Multiple scripts handle different functionality
3. Modular loading with error handling

### Core Files & Their Role
```
📁 Content Scripts Architecture
├── 🎯 src/interactionContent.js (Main content script)
│   └── Loads other modules dynamically
│   └── Text selection tracking
│   └── Activity tracking
│
├── 🎯 src/contentInteractions.js (Loaded dynamically)  
│   └── Additional interaction tracking
│   └── Preview collection
│
└── 🎯 src/footerBar.js (Loaded dynamically)
    └── Floating button injection
```

### Dependencies & Impact Areas
- **If you modify** content script loading → affects all page-level features
- **If you modify** web accessible resources → breaks dynamic imports
- **If you modify** content security policy → breaks script loading

---

## 📱 Responsive Header/Sidebar System

### How it Works
1. App.jsx detects window width changes via resize event listener
2. At widths < 1200px or when user enables vertical layout, switches to VerticalHeader  
3. At widths ≥ 1200px, shows horizontal Header (unless user preference overrides)
4. Content area automatically adjusts margins based on sidebar state
5. Both components share unified theming system with CSS variables

### Core Files & Their Role
```
📁 Responsive Header Architecture
├── 🎯 src/App.jsx (lines 91, 114-122, 1312-1318, 1547-1578)
│   └── Window resize detection and responsive logic
│   └── Conditional rendering of Header vs VerticalHeader
│   └── Dynamic content margin calculations
│
├── 🎯 src/components/toolbar/Header.jsx
│   └── Horizontal header for wide screens (≥1200px)
│   └── CSS classes: "header ai-header"
│   └── Themed with CSS variables (--glass-bg, --border-color, --text-primary)
│
├── 🎯 src/components/toolbar/VerticalHeader.jsx
│   └── Vertical sidebar for narrow screens (<1200px) or user preference
│   └── CSS classes: "vertical-sidebar ai-sidebar"  
│   └── Auto-collapse behavior (280px expanded, 60px collapsed)
│   └── Includes VoiceNavigation integration
│
├── 🎯 src/App.css (lines 32-41)
│   └── Theme CSS classes: .header.ai-header, .vertical-sidebar.ai-sidebar
│   └── CSS variables for consistent theming across components
│
└── 🎯 src/index.css (cleaned up, lines 114+)
    └── Sidebar button styles and animations
    └── Removed conflicting responsive CSS rules
```

### Responsive Breakpoints
```
🖥️ Layout Logic:
├── Window Width ≥ 1200px → Header.jsx (horizontal)
├── Window Width < 1200px → VerticalHeader.jsx (auto-collapsed, 60px)
├── User Preference Override → Can force vertical layout at any width  
└── Smooth Transitions → CSS transitions for width/margin changes
```

### Unified Theming System
```
🎨 CSS Variables Used (both components):
├── --glass-bg → Background with glass effect fallbacks
├── --border-color → All borders, dividers, and outlines  
├── --text-primary → Primary text (logos, headings, time display)
├── --text → Secondary text (navigation labels, content)
├── --text-dim → Disabled/dimmed text states
├── --primary → Active button gradients and accents
└── --accent → Secondary accent colors for gradients
```

### Component Feature Parity
```
✅ Both Header & VerticalHeader Include:
├── Search functionality (SearchBox/VerticalSearchBox)
├── VoiceNavigation integration with proper positioning
├── Music controls (inline in Header, grouped in VerticalHeader)
├── Navigation arrows/sections for ActivityPanel
├── All action buttons (Create Workspace, Settings, Gmail, Calendar, Help)
├── Time display (horizontal text vs rotated in collapsed mode)
└── Unified theming with CSS variable fallbacks
```

### Dependencies & Impact Areas
- **If you modify** window resize logic → affects responsive switching
- **If you modify** CSS variables → affects theming across both components
- **If you modify** VerticalHeader props → ensure Header has matching props
- **If you modify** VoiceNavigation positioning → test in both layouts
- **If you modify** theme classes → update both .ai-header and .ai-sidebar

---

## 🎤 Voice Navigation Feature

### How it Works
1. User clicks voice navigation button or uses keyboard shortcut
2. Speech recognition starts listening for voice commands  
3. Voice commands are processed and matched to actions
4. Actions are executed via Chrome APIs or page injection scripts
5. Visual feedback shows numbered elements for interaction
6. Real-time positioning updates as user scrolls or page content changes

### Core Files & Their Role
```
📁 Voice Navigation Architecture
├── 🎯 src/services/voiceCommandProcessor.js
│   └── VoiceCommandProcessor class with 50+ command patterns
│   └── Tab management, search, website opening, element clicking
│   └── Integration with pageInteractionService for page manipulation
│
├── 🎯 src/components/toolbar/VoiceNavigation.jsx (2000+ lines)
│   └── React component with speech recognition integration
│   └── Element numbering system with smart positioning
│   └── Theme-aware UI with collapsible interface
│   └── Real-time scroll tracking and mutation observation
│
├── 🎯 src/services/pageInteractionService.js (referenced but not shown)
│   └── Page injection utilities for element interaction
│   └── Link clicking, scrolling, element detection functions
│
└── 🎯 Chrome Extension APIs
    └── chrome.tabs - Tab management and switching
    └── chrome.windows - Window operations
    └── chrome.scripting - Page script injection
    └── Web Speech Recognition API - Voice input processing
```

### Voice Command Categories
```
🗣️ Command Types & Examples:
├── Tab Management
│   └── "switch to tab 2", "close tab", "new tab", "duplicate tab"
├── Tab Search & Navigation  
│   └── "go to github", "find tab youtube", "search tab gmail"
├── Web Search
│   └── "search for cats", "google search dogs", "search youtube music"
├── Website Opening
│   └── "open gmail", "go to calendar", "open github"  
├── Element Interaction
│   └── "click subscribe", "show numbers", "click 5"
├── Page Navigation
│   └── "scroll down", "go back", "go forward"
├── Content Reading
│   └── "content mode", "read 3", "mark content"
└── Window Management
    └── "new window", "close window"
```

### Element Numbering System
```
🔢 Numbering Features:
├── Smart Element Detection
│   └── 20+ CSS selectors for interactive elements
│   └── Visibility filtering and priority scoring
│   └── GitHub-specific and platform-aware selectors
├── Visual Overlays
│   └── Absolute positioned numbered circles
│   └── Anti-collision positioning with smart placement
│   └── Real-time updates during scroll and content changes
├── Interaction Modes
│   └── Interactive Mode: Buttons, links, form elements
│   └── Content Mode: Headings, paragraphs, articles
└── Dynamic Updates
    └── Mutation observer for DOM changes
    └── Scroll event throttling for performance  
    └── Auto-refresh when new elements appear
```

### Data Flow
```
Voice Input → Speech Recognition → Command Processing → Chrome APIs
                                                     ↓
Page Script Injection ← Element Numbering ← Action Execution
                                                     ↓
Visual Feedback ← Position Updates ← Mutation Observer ← DOM Changes
```

### Dependencies & Impact Areas
- **If you modify** voice command patterns → affects command recognition accuracy
- **If you modify** element selection criteria → breaks numbered clicking functionality
- **If you modify** Chrome scripting permissions → breaks page interaction features
- **If you modify** speech recognition config → affects voice input reliability  
- **If you modify** scroll/mutation observers → breaks real-time element positioning
- **If you modify** theme system → affects voice navigation UI appearance
- **If you modify** page injection scripts → breaks link clicking and page interaction

---

## 📊 Grid Components Feature

### How it Works
1. **ProjectGrid**: Uses GenericUrlParser to intelligently group URLs by platform (GitHub, ChatGPT, etc.)
2. **ItemGrid**: Groups URLs by domain with simpler categorization for general browsing
3. Both components provide keyboard navigation, filtering, and time tracking integration
4. Users can filter content using interactive category chips
5. Components maintain focus management and accessibility features

### Core Files & Their Role
```
📁 Grid Components Architecture
├── 🎯 src/components/ProjectGrid.jsx (263 lines)
│   └── Platform-based URL grouping using GenericUrlParser
│   └── Hierarchical workspace structure with intelligent parsing
│   └── Filter system based on platform categories (GitHub, Claude, etc.)
│   └── Integration with WorkspaceProject components for rendering
│
├── 🎯 src/components/ItemGrid.jsx (329 lines)  
│   └── Domain-based URL grouping for simpler categorization
│   └── Workspace association and filtering capabilities
│   └── Integration with WorkspaceItem components for rendering
│   └── Category management using categories.js data
│
├── 🎯 src/components/WorkspaceProject.jsx (referenced)
│   └── Individual project workspace display component
│   └── Handles project-level interactions and time display
│
├── 🎯 src/components/WorkspaceItem.jsx (referenced)
│   └── Individual workspace item display component
│   └── Handles item-level interactions and workspace linking
│
└── 🎯 Supporting Utilities
    └── src/utils/GenericUrlParser.js - Platform detection and parsing
    └── src/data/categories.js - Category definitions and management
    └── src/utils.js - URL utility functions (getDomainFromUrl, getUrlParts)
```

### Data Processing Flow
```
🔄 ProjectGrid Data Flow:
Raw URLs → GenericUrlParser.parseMultiple() → Platform Groups → Workspace Filtering
                                                     ↓
WorkspaceProject Components ← Memoized Filtering ← Category Stats ← Time Tracking

🔄 ItemGrid Data Flow:  
Raw URLs → getUrlParts() → Domain Groups → Workspace Association → Category Filtering
                                               ↓
WorkspaceItem Components ← Display Groups ← Filter Chips ← Time Tracking Integration
```

### Keyboard Navigation System
```
⌨️ Navigation Features:
├── Arrow Key Support
│   └── ArrowRight/ArrowLeft: Move horizontally through grid items
│   └── ArrowUp/ArrowDown: Move vertically (4-column grid assumption)
│   └── Enter/Space: Activate filter chips and items
├── Focus Management
│   └── Auto-focus first item or chip when content changes
│   └── Respect input/textarea focus to avoid conflicts
│   └── Ref-based focus tracking for smooth navigation
├── Accessibility
│   └── Role="grid" for screen readers
│   └── Proper tabindex management
│   └── Focus indicators and keyboard shortcuts
└── Event Handling
    └── Global keydown listener with target filtering
    └── Prevents conflicts with form inputs
    └── Proper event propagation control
```

### Filtering & Organization
```
🏷️ Filter System:
├── ProjectGrid Filtering
│   └── Platform-based: GitHub, ChatGPT, Claude, Figma, etc.
│   └── Workspace type filtering (projects, conversations)
│   └── Dynamic category stats from GenericUrlParser
│
├── ItemGrid Filtering  
│   └── Domain-based: Groups by website domain
│   └── Workspace association filtering
│   └── Simple "All" vs specific domain filtering
│
├── Interactive Filter Chips
│   └── Click to activate/deactivate filters
│   └── Item count badges for each category
│   └── Visual feedback with colors and animations
│   └── Keyboard navigation support
│
└── Performance Optimization
    └── useMemo for expensive filtering operations
    └── Efficient re-computation only when data changes
    └── Debounced focus management
```

### Time Tracking Integration
```
⏱️ Time Tracking Features:
├── Chrome Runtime Integration
│   └── Fetches time spent data via chrome.runtime.sendMessage
│   └── Handles connection errors gracefully
│   └── Updates timeSpent state for display
│
├── Error Handling
│   └── Proper chrome.runtime.lastError checking
│   └── Fallback for missing background service
│   └── Promise-based async handling with try/catch
│
└── Display Integration
    └── Passes timeSpentMs to WorkspaceProject/WorkspaceItem
    └── Visual time indicators in component UI
    └── Real-time updates when data changes
```

### Dependencies & Impact Areas
- **If you modify** GenericUrlParser integration → affects ProjectGrid platform grouping
- **If you modify** keyboard navigation logic → breaks arrow key navigation
- **If you modify** workspace filtering → affects category display and stats
- **If you modify** time tracking integration → breaks time display features
- **If you modify** focus management → affects accessibility and UX
- **If you modify** memoization logic → impacts performance with large datasets
- **If you modify** Chrome runtime patterns → breaks background service communication
- **If you modify** 4-column grid assumptions → breaks vertical navigation

---

## 📌 Pins/Pings Section Feature

### How it Works
1. Users can pin/bookmark important tabs for quick access
2. Pins are stored persistently in the database with metadata (title, favicon, timestamp)
3. Real-time updates across all components via database subscription system
4. Smart navigation detects existing tabs vs creating new ones
5. Visual UI with hover effects, favicons, and action buttons
6. Limited to 6 visible pins for optimal UX

### Core Files & Their Role
```
📁 Pins/Pings Architecture
├── 🎯 src/components/default/PingsSection.jsx (337 lines)
│   └── Main component for pin management and display
│   └── Real-time database subscription integration
│   └── Smart tab focusing and creation logic
│   └── Cross-platform Chrome + Electron support
│
├── 🎯 src/db/index.js (Unified DB API)
│   └── dbListPings() - Retrieve all pins from storage
│   └── dbUpsertPing() - Create or update pin data
│   └── dbDeletePing() - Remove pin by URL
│   └── subscribePinsChanges() - Real-time update subscription
│
├── 🎯 src/services/extensionApi.js
│   └── enqueueOpenInChrome() - Electron integration for opening URLs
│   └── Bridge between extension and host application
│
└── 🎯 src/utils.js
    └── getFaviconUrl() - Favicon retrieval with fallbacks
    └── URL parsing and validation utilities
```

### Pin Data Structure
```
📋 Pin Object Schema:
{
  id: "ping_timestamp_randomId",     // Unique identifier
  url: "https://example.com",        // Target URL
  title: "Page Title",               // Display title (fallback to hostname)
  favicon: "https://example.com/favicon.ico", // Favicon URL with fallbacks
  createdAt: 1640995200000          // Timestamp for sorting
}
```

### Smart Navigation System
```
🧠 Intelligent Tab Handling:
├── Tab Detection Logic
│   └── URL normalization and comparison
│   └── Active tab matching across windows
│   └── Window focus management for existing tabs
│
├── Platform-Specific Handling
│   └── Chrome Extension: Direct chrome.tabs API usage
│   └── Electron App: extensionApi bridge integration
│   └── Fallback error handling for both platforms
│
└── User Experience
    └── Focus existing tab if already open
    └── Create new tab only when needed
    └── Proper window focus for cross-window tabs
```

### Real-time Update System
```
🔄 Live Synchronization:
Database Changes → subscribePinsChanges() → Component Re-render
                                        ↓
Multiple Components ← BroadcastChannel ← Database Subscription
                                        ↓
Consistent State ← Automatic Reload ← Pin CRUD Operations
```

### Favicon Management Strategy
```
🖼️ Multi-layered Favicon Handling:
├── Primary Sources
│   └── tab.favIconUrl from Chrome tabs API
│   └── getFaviconUrl() utility with size parameter
│   └── Domain-based favicon.ico fallback
│
├── Validation & Safety
│   └── HTTP/HTTPS protocol validation
│   └── URL parsing and origin extraction
│   └── Error handling for invalid URLs
│
├── Display & Fallback
│   └── Image error handling with hide on failure
│   └── FontAwesome pin icon as ultimate fallback
│   └── Styled containers with proper dimensions
│
└── Performance
    └── Lazy loading with onError handlers
    └── Cached favicon URLs where possible
    └── Optimized re-rendering patterns
```

### UI Components & Styling
```
🎨 Visual Design System:
├── Apple-style Design Language
│   └── SF Pro Display font stack
│   └── Rounded corners and backdrop blur effects
│   └── Smooth transitions and hover animations
│
├── Interactive Elements
│   └── Hover effects with transform and glow
│   └── Action buttons with color-coded states
│   └── Visual feedback for all interactions
│
├── Information Hierarchy
│   └── Pin count badge with orange accent
│   └── Title and hostname display with truncation
│   └── Favicon integration with styled containers
│
└── Accessibility Features
    └── Proper button titles and ARIA labels
    └── Keyboard navigation support
    └── High contrast color schemes
```

### Data Flow
```
User Action → Pin Creation → Database Storage → Real-time Sync
                                              ↓
Component Update ← subscribePinsChanges() ← BroadcastChannel
                                              ↓
UI Refresh ← State Update ← Automatic Reload ← Database Change
```

### Dependencies & Impact Areas
- **If you modify** database subscription logic → breaks real-time updates across components
- **If you modify** tab focusing logic → affects Chrome vs Electron platform compatibility
- **If you modify** favicon handling → breaks visual pin representation
- **If you modify** URL matching logic → affects smart tab detection accuracy
- **If you modify** pin limit (6 pins) → impacts UI layout and performance
- **If you modify** database API integration → breaks pin persistence
- **If you modify** extensionApi bridge → breaks Electron app integration
- **If you modify** real-time update patterns → causes state inconsistencies

---

## 📝 Notes Section with Voice Features

### How it Works
1. **Text Input**: Users type notes with status selection (Todo/In Progress/Done)
2. **Voice Recording**: Two recording modes - pure audio or speech-to-text with audio backup
3. **Speech Recognition**: Real-time transcription with live text display
4. **Note Management**: CRUD operations with inline editing and status updates
5. **Display Control**: Limit notes shown with expand/collapse functionality

### Core Files & Their Role
```
📁 Notes Section Architecture
├── 🎯 src/components/default/NotesSection.jsx (1021 lines)
│   └── Complete note management with voice integration
│   └── Speech-to-text with dual audio recording system
│   └── Status management with visual indicators
│   └── Inline editing with auto-resize text areas
│
├── 🎯 src/db/index.js (Unified DB API)
│   └── dbListNotes() - Retrieve all notes from storage
│   └── dbUpsertNote() - Create or update note data
│   └── dbDeleteNote() - Remove note by ID
│
└── 🎯 Web APIs Integration
    └── Web Speech Recognition API - Real-time transcription
    └── MediaRecorder API - Audio capture and processing
    └── FileReader API - Base64 audio encoding
    └── Audio API - Playback of recorded voice notes
```

### Note Data Structure
```
📋 Note Object Schema:
// Text Note
{
  id: "timestamp_randomId",
  type: "text",
  text: "Note content",
  status: "todo|in-progress|done",
  createdAt: 1640995200000
}

// Voice Note (Audio Only)
{
  id: "timestamp_randomId",
  type: "voice", 
  audioData: "base64EncodedAudio",
  duration: 45, // seconds
  status: "todo",
  createdAt: 1640995200000
}

// Hybrid Voice+Text Note
{
  id: "timestamp_randomId",
  type: "voice-text",
  text: "Transcribed content",
  audioData: "base64EncodedAudio", 
  duration: 45,
  hasTranscription: true,
  status: "todo",
  createdAt: 1640995200000
}
```

### Voice Recording Systems
```
🎙️ Dual Recording Architecture:
├── Pure Voice Recording (startRecording/stopRecording)
│   └── MediaRecorder → Audio chunks → Base64 → Storage
│   └── Manual start/stop control
│   └── Creates 'voice' type notes
│
├── Speech-to-Text Recording (startSpeechToText/stopSpeechToText) 
│   └── Parallel: SpeechRecognition + MediaRecorder
│   └── Real-time transcription with audio backup
│   └── Auto-saves when recognition ends
│   └── Creates 'voice-text' type notes
│
└── Audio Playback System
    └── Base64 → Audio objects → Playback controls
    └── Single audio playing at a time
    └── Play/pause state management
```

### Speech Recognition Integration
```
🗣️ Speech-to-Text Features:
├── Configuration
│   └── Continuous: true (for long recordings)
│   └── Interim results: true (real-time display) 
│   └── Language: en-US (with translation capability)
│
├── Real-time Processing
│   └── Final transcript accumulation
│   └── Interim results display
│   └── Live text input update
│   └── Character count tracking
│
├── Error Handling
│   └── Microphone permission checks
│   └── Browser compatibility validation
│   └── Recording failure recovery
│   └── Audio recording backup on speech failure
│
└── User Experience
    └── Visual recording timer
    └── Placeholder text updates during recording
    └── Auto-save on recognition end
    └── Text input sync with transcription
```

### Status Management System
```
📊 Todo Workflow:
├── Status Types
│   └── "todo": Circle icon, white/transparent
│   └── "in-progress": Clock icon, orange (#FF9500)
│   └── "done": Check icon, green (#34C759)
│
├── Visual Indicators
│   └── Color-coded status dropdowns
│   └── Icon-based status representation
│   └── Hover effects and transitions
│
├── Status Changes
│   └── Dropdown selection triggers database update
│   └── Immediate visual feedback
│   └── Real-time status persistence
│
└── Creation Status
    └── New note status selection
    └── Default: "todo" 
    └── Visual preview of selected status
```

### UX Issues & Complexity Problems
```
⚠️ Current Design Problems:
├── Button Confusion
│   └── Save button: Manual text saving
│   └── Microphone button: Auto-saves speech
│   └── Users unsure which to use when
│
├── Recording System Overlap
│   └── Two recording functions for different purposes
│   └── No clear distinction in UI
│   └── Dual audio capture systems
│
├── Auto-save vs Manual Save Inconsistency
│   └── Speech-to-text: Auto-saves immediately
│   └── Manual typing: Requires Save button
│   └── Mixed interaction paradigms
│
└── State Management Complexity
    └── isRecording vs isTranscribing states
    └── mediaRecorder for both systems
    └── recordingTime shared between systems
```

### Suggested UX Improvements
```
💡 Proposed Solutions:
├── Unified Recording Button
│   └── Single microphone button with mode selection
│   └── Toggle between "Audio Only" and "Transcribe + Audio"
│   └── Clear visual indication of current mode
│
├── Consistent Auto-save
│   └── Remove manual Save button
│   └── Auto-save text notes after typing pause
│   └── Unified saving experience across all input types
│
├── Simplified Recording States
│   └── Single recording state variable
│   └── Clear mode indication (audio vs transcription)
│   └── Consistent timer and feedback display
│
└── Enhanced Visual Feedback
    └── Recording mode indicator
    └── Clear audio/transcription status
    └── Unified progress feedback
```

### Dependencies & Impact Areas
- **If you modify** speech recognition logic → affects real-time transcription accuracy
- **If you modify** MediaRecorder integration → breaks audio recording and playback
- **If you modify** dual recording system → impacts voice-text note creation
- **If you modify** status management → affects todo workflow functionality  
- **If you modify** database integration → breaks note persistence and updates
- **If you modify** auto-resize textarea → affects inline editing experience
- **If you modify** base64 audio encoding → breaks voice note playback
- **If you modify** recording state management → causes UI inconsistencies

---

## 🚨 Critical Dependencies Map

### Message Routing Dependencies
```
activity.js exclusions → Controls which messages reach main handlers
                      ↓
MUST exclude: textSelected, updateDailyNotes, openSidePanel
              (or those features break)
```

### Storage Dependencies  
```
Chrome Storage Keys:
├── dailyNotes_YYYY-MM-DD → Daily notes data
├── dailyNotesLastUpdate → Real-time sync
├── urlNotes_[url-hash] → URL-specific notes
├── activityData_* → Time series activity data
├── workspaces → Workspace definitions and metadata
├── workspacesMirroredOnce → Host sync completion flag
├── urlsMirroredOnce → URL backfill completion flag
└── workspace_urls_* → URL-to-workspace relationships
```

### Permission Dependencies
```
manifest.json permissions REQUIRED for:
├── sidePanel → Side panel functionality  
├── scripting → Content script injection
├── activeTab → Text selection access
├── storage → All data persistence
└── tabs → Tab management features
```

---

## 🔍 Impact Analysis Questions

Before modifying any file, ask:

1. **Does this file handle messages?** → Check activity.js exclusions
2. **Does this affect side panel?** → Don't add setOptions() calls  
3. **Does this change storage keys?** → Will break existing data
4. **Does this modify content scripts?** → May break page-level features
5. **Does this change manifest permissions?** → May break Chrome APIs

---

## 🛡️ Safe Modification Guidelines

### ✅ Generally Safe to Modify
- UI styling and layout
- Text content and labels  
- Console log messages
- Non-critical utility functions

### ⚠️ Modify with Caution
- Message handlers (ensure responses are sent)
- Storage operations (maintain key consistency)
- Content script loading logic
- Error handling patterns

### 🚨 Never Modify Without Understanding Impact
- activity.js message exclusions
- Side panel opening logic  
- Chrome storage keys
- Content Security Policy
- Manifest permissions

---

*Last Updated: 2025-01-12*
*This document should be updated whenever architectural changes are made.*