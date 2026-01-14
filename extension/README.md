# CoolDesk Chrome Extension

## Single Purpose
CoolDesk is a **productivity enhancement extension** that captures and organizes web content for daily note-taking and workspace management. The extension serves one primary function: to help users collect, categorize, and manage information from their browsing sessions in an organized workspace environment.

## Core Functionality
- **Text Selection Capture**: Automatically saves selected text from web pages to daily notes
- **Workspace Organization**: Categorizes captured content by domain and context
- **Side Panel Interface**: Provides a dedicated workspace for managing notes and tabs
- **Tab Management**: Helps organize and clean up browser tabs with activity tracking

## Permission Justifications

### Required Permissions

#### `activeTab`
**Purpose**: Access the currently active tab to capture selected text and page metadata
**Justification**: Essential for the core functionality of capturing user-selected content from web pages. Only accesses the active tab when user initiates an action.

#### `storage`
**Purpose**: Store captured notes, workspace data, and user preferences locally
**Justification**: Required to persist user's notes, workspace configurations, and settings. All data is stored locally on the user's device.

#### `sidePanel`
**Purpose**: Display the extension's main interface in the browser's side panel
**Justification**: Provides a dedicated workspace interface without interfering with the user's browsing experience.

#### `tabs`
**Purpose**: Access tab information for workspace organization and tab management features
**Justification**: Enables tab cleanup functionality and workspace categorization based on open tabs. Used to help users organize their browsing sessions.

#### `sessions`
**Purpose**: Access recently closed tabs for restore functionality
**Justification**: Allows users to restore accidentally closed tabs, enhancing the tab management capabilities.

#### `history`
**Purpose**: Access browser history to enhance workspace organization and context
**Justification**: Enables intelligent workspace categorization by analyzing visit patterns and provides context for captured content. Helps users understand when and how often they've visited sources of their captured notes.

#### `bookmarks`
**Purpose**: Access and organize bookmarks within workspace contexts
**Justification**: Allows integration of bookmarked content with captured notes and workspace organization. Users can see relevant bookmarks alongside their captured content for better context and organization.

#### `idle`
**Purpose**: Detect user idle state for optimizing background operations
**Justification**: Enables smart timing for cleanup operations and reduces resource usage when the user is away. Helps optimize tab cleanup and data synchronization without interrupting active work.

#### `contextMenus`
**Purpose**: Add context menu options for quick content capture
**Justification**: Provides an alternative method for users to capture selected text and page content through right-click context menus, enhancing accessibility and user experience.

#### `identity`
**Purpose**: Enable user authentication for workspace synchronization (optional)
**Justification**: Allows users to optionally sync their workspaces and notes across devices while maintaining privacy. Authentication is completely optional and user-controlled.

#### `search`
**Purpose**: Search through captured notes and workspace content
**Justification**: Enables users to quickly find specific content within their captured notes and workspace data. Essential for productivity as users accumulate large amounts of captured content over time.

#### `scripting`
**Purpose**: Inject content scripts for text selection capture and floating button
**Justification**: Required to detect text selection events and display the floating access button on web pages. Scripts only activate on user interaction.

#### `background`
**Purpose**: Handle message passing between content scripts and the extension interface
**Justification**: Coordinates communication between the webpage content scripts and the side panel interface for seamless functionality.

### Host Permissions

#### `http://*/*` and `https://*/*`
**Purpose**: Access web pages to capture selected text and inject interface elements
**Justification**: The extension's core purpose is to capture content from any website the user visits. Broad host permissions are necessary because users may want to capture content from any domain.

#### `chrome://favicon/*`
**Purpose**: Display website favicons in the workspace interface
**Justification**: Enhances the user experience by showing recognizable website icons alongside captured content and tab information.

## Privacy & Security

### Data Handling
- **Local Storage Only**: All captured content and user data is stored locally using Chrome's storage API
- **No External Servers**: The extension does not transmit any user data to external servers
- **User-Initiated Actions**: Content is only captured when users explicitly select text or interact with the extension

### Minimal Data Collection
- Only captures text that users explicitly select
- Stores page titles and URLs for organizational purposes
- No tracking of browsing behavior beyond user-initiated captures

### Security Measures
- Content scripts are isolated and only inject minimal interface elements
- No eval() or unsafe JavaScript execution
- Follows Chrome extension security best practices

## Installation & Usage

1. Load the extension in Chrome Developer Mode
2. Click the floating button on any webpage or open the side panel
3. Select text on web pages to automatically capture it to your daily notes
4. Organize captured content in workspaces within the side panel
5. Use tab management features to keep your browser organized

## Technical Architecture

- **Content Scripts**: Minimal scripts for text selection detection and floating button
- **Background Script**: Handles message routing and storage operations
- **Side Panel**: React-based interface for workspace management
- **Local Database**: Structured storage for notes and workspace data

This extension is designed with user privacy and browser performance in mind, only accessing the minimum required permissions to deliver its core productivity enhancement functionality.

## Store Listing

### Title
CoolDesk - Web Content Capture & Workspace Organizer

### Summary
Transform your web browsing into productive workspaces with smart content capture, daily notes, and intelligent organization.

### Description (Markdown - for reference)

CoolDesk transforms your web browsing into an organized productivity workspace. Capture, organize, and manage web content with intelligent automation and seamless note-taking.

**Core Features:**
- Select text on any webpage to automatically save to daily notes
- Smart workspace organization by domain and topic
- Advanced tab management with auto-cleanup and restore
- Searchable content library with timestamps and context
- Right-click context menu for quick content capture
- Floating access button for easy extension access

**Key Benefits:**
- All data stored locally on your device for complete privacy
- Lightweight design that doesn't slow down browsing
- Perfect for researchers, students, and professionals
- Intelligent categorization reduces manual organization
- Restore accidentally closed tabs with one click
- Search through all captured content instantly

**Privacy First:**
No external data transmission. All captured content remains on your device with optional user-controlled sync.

**How It Works:**
1. Select text on webpages to capture automatically
2. Content organizes into workspaces by topic and domain
3. Access everything through the clean side panel interface
4. Search and export your knowledge base anytime

Turn scattered web browsing into structured knowledge management. Perfect for building research collections, study materials, and project documentation.

### Description (Plain Text - for browser stores)

CoolDesk transforms your web browsing into an organized productivity workspace. Capture, organize, and manage web content with intelligent automation and seamless note-taking.

Core Features:
• Select text on any webpage to automatically save to daily notes
• Smart workspace organization by domain and topic
• Advanced tab management with auto-cleanup and restore
• Searchable content library with timestamps and context
• Right-click context menu for quick content capture
• Floating access button for easy extension access

Key Benefits:
• All data stored locally on your device for complete privacy
• Lightweight design that doesn't slow down browsing
• Perfect for researchers, students, and professionals
• Intelligent categorization reduces manual organization
• Restore accidentally closed tabs with one click
• Search through all captured content instantly

Privacy First:
No external data transmission. All captured content remains on your device with optional user-controlled sync.

How It Works:
1. Select text on webpages to capture automatically
2. Content organizes into workspaces by topic and domain
3. Access everything through the clean side panel interface
4. Search and export your knowledge base anytime

Turn scattered web browsing into structured knowledge management. Perfect for building research collections, study materials, and project documentation.

### Category
Productivity

### Keywords
productivity, notes, workspace, content capture, tab management, research, organization, knowledge management, daily notes, web clipper