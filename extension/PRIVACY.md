# CoolDesk Extension - Privacy Policy & Permission Policy

**Last Updated:** January 2025  
**Version:** 0.1.0

## Overview

CoolDesk is a Chrome extension designed to enhance your browsing productivity through workspace management, daily notes, tab organization, and voice navigation. This document explains what data we collect, how we use it, and your rights regarding your information.

---

## 1. Information We Collect

### 1.1 Browsing Data (Local Storage Only)
CoolDesk collects and stores the following data **locally on your device**:

- **Browser History**: We access your browsing history (configurable, default: last 30 days, max 1000 items) to:
  - Organize URLs into workspaces based on topics and categories
  - Provide quick access to frequently visited sites
  - Generate intelligent workspace suggestions
  
- **Bookmarks**: We read your Chrome bookmarks to:
  - Include them in workspace organization
  - Provide unified access to saved resources
  
- **Tab Information**: We track open tabs to:
  - Display current tabs in the side panel
  - Enable auto-cleanup of inactive tabs (optional, user-controlled)
  - Restore recently closed tabs
  - Provide voice-controlled tab switching

- **Text Selections**: When you select text on web pages (≥15 characters), we capture:
  - Selected text content
  - Surrounding context (50 characters before/after)
  - Page URL and timestamp
  - **Purpose**: Auto-save to Daily Notes for quick reference
  - **Note**: This feature can be disabled in settings

- **Page Interactions** (Optional - Disabled by Default):
  - Scroll position, clicks, form submissions, page visibility
  - **Purpose**: Activity analytics and usage patterns
  - **Control**: Requires explicit opt-in via `chrome.storage.local.set({ privacySettings: { telemetry: true } })`

### 1.2 User-Created Content
- **Daily Notes**: Text notes you create or auto-captured from selections
- **Workspace Configurations**: Custom workspace names, categories, and organization
- **Settings & Preferences**: Theme choices, font settings, cleanup rules, excluded domains

### 1.3 Data We Do NOT Collect
- ❌ **No server transmission**: All data stays on your device (Chrome local storage and IndexedDB)
- ❌ **No authentication data**: We do not collect passwords, login credentials, or authentication cookies
- ❌ **No financial information**: No payment or financial data is accessed
- ❌ **No cross-site tracking**: We do not track you across websites for advertising
- ❌ **No third-party sharing**: Your data is never sold, shared, or transmitted to third parties

---

## 2. How We Use Your Data

### 2.1 Core Functionality
All data collection serves **user-facing features** prominently described in the extension:

| Data Type | Purpose | User Benefit |
|-----------|---------|--------------|
| History & Bookmarks | Workspace auto-creation and organization | Smart categorization of your browsing into topics |
| Text Selections | Daily Notes auto-capture | Quick reference without manual copy-paste |
| Tab Information | Tab management and voice navigation | Hands-free browsing and auto-cleanup |
| Page Interactions | Activity tracking (opt-in) | Personal usage insights |

### 2.2 Data Storage
- **Local Storage**: All data is stored in Chrome's local storage (`chrome.storage.local`) and IndexedDB
- **No Cloud Sync**: Data does not leave your device unless you explicitly enable optional features (currently disabled in this build)
- **Encryption**: Data at rest uses Chrome's built-in storage encryption

### 2.3 Data Retention
- **History/Bookmarks**: Refreshed based on your configured settings (default: 30 days)
- **Daily Notes**: Retained until you manually delete them
- **Activity Data**: Stored locally with automatic cleanup of data older than 30 days
- **Cache**: Dashboard data cached for 30 minutes to improve performance

---

## 3. Chrome Permissions Explained

CoolDesk requests the following permissions. Each is **necessary** for core functionality:

### Required Permissions

| Permission | Why We Need It | How We Use It |
|------------|----------------|---------------|
| **storage** | Save settings, notes, and workspace data locally | Store all user data in Chrome's local storage |
| **history** | Access browsing history for workspace organization | Read history to categorize URLs into workspaces |
| **bookmarks** | Include bookmarks in workspace management | Display and organize your saved bookmarks |
| **tabs** | Manage open tabs and provide tab switching | Display current tabs, enable voice navigation, tab cleanup |
| **windows** | Manage browser windows | Focus windows when switching tabs via voice |
| **sidePanel** | Display extension UI in Chrome's side panel | Provide the main CoolDesk interface |
| **search** | Enable search functionality | Search through your workspaces and notes |
| **scripting** | Inject scripts for voice navigation and DOM interaction | Enable "click button", "scroll down" voice commands on web pages |
| **idle** | Detect user inactivity | Trigger auto-cleanup of inactive tabs (optional feature) |
| **activeTab** | Access the currently active tab | Execute voice commands on the current page |
| **contextMenus** | Add right-click menu options | Quick actions for saving to workspaces |
| **sessions** | Access recently closed tabs | Restore recently closed tabs feature |

### Content Scripts
- **Scope**: Runs on `http://*/*` and `https://*/*` (all web pages)
- **Purpose**: 
  - Track text selections for Daily Notes auto-capture
  - Monitor page interactions (scroll, clicks) if telemetry is enabled
  - Enable voice navigation DOM manipulation
- **Limitations**: Cannot run on `chrome://`, `edge://`, or `chrome-extension://` pages

### No Host Permissions
- **Security**: We do **not** request `<all_urls>` or broad host permissions
- **Network**: Content Security Policy restricts network requests to `'self'` only (no external API calls from extension pages)

---

## 4. Data Security

### 4.1 Transmission Security
- **No Network Transmission**: Data is not transmitted over the network in this build
- **Local-Only**: All processing happens on your device
- **CSP Protection**: Content Security Policy prevents unauthorized network requests

### 4.2 Storage Security
- **Chrome's Built-in Encryption**: Leverages Chrome's storage encryption
- **No Plain-Text Passwords**: We do not store or access authentication credentials
- **Isolated Storage**: Extension storage is isolated from web pages

### 4.3 Third-Party Code
- **Voice Recognition**: Uses browser's native Web Speech API (no external service)
- **No Analytics**: No tracking pixels or third-party analytics

---

## 5. User Control & Privacy Rights

### 5.1 Data Access & Deletion
- **View Your Data**: All data is stored locally; inspect via Chrome DevTools → Application → Storage
- **Delete Data**: 
  - Individual items: Delete notes, workspaces via the UI
  - All data: Uninstall the extension or clear Chrome storage
- **Export**: Currently manual (copy from UI); export feature planned

### 5.2 Opt-Out Options
- **Text Selection Tracking**: Disable in Settings → Privacy (planned)
- **Page Interaction Telemetry**: Disabled by default; requires explicit opt-in
- **Tab Auto-Cleanup**: Toggle on/off via the broom icon in Current Tabs section
- **Voice Navigation**: Only active when you trigger it; no passive listening

### 5.3 Transparency
- **Open Source**: Code is available for inspection
- **No Hidden Features**: All data collection is for described user-facing features
- **No Monetization**: We do not use your data for advertising or sell it to third parties

---

## 6. Compliance with Chrome Web Store Policies

### 6.1 Limited Use Requirements
CoolDesk complies with Chrome Web Store's [Limited Use Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use):

- ✅ **Allowed Use**: Data is used **only** to provide user-facing features (workspace management, notes, tab control)
- ✅ **Allowed Transfer**: No data is transferred to third parties
- ✅ **Prohibited Advertising**: We do **not** use your data for personalized, re-targeted, or interest-based ads
- ✅ **Prohibited Human Interaction**: No humans read your data; all processing is automated and local

### 6.2 Minimum Permission Principle
- We request **only** the permissions necessary for current functionality
- No "future-proofing" with unused permissions
- Optional permissions used for add-on features (none currently active)

### 6.3 Prominent Disclosure
- **In-Product Notice**: Settings panel includes privacy summary
- **User Consent**: Text selection auto-capture requires user awareness (planned: first-run consent dialog)
- **No Hidden Collection**: All data handling is disclosed in this policy and the extension description

---

## 7. Changes to Disabled Features

### 7.1 Currently Disabled (This Build)
The following features are **disabled** in version 0.1.0 to maintain a minimal, privacy-focused build:

- **Firebase Authentication**: `AUTH_DISABLED = true` in `src/services/firebase.js`
  - No Google sign-in or cloud sync
  - Account tab hidden in Settings
  
- **Localhost Host Sync**: `enableHostSync: false` in `src/services/syncConfig.js`
  - No communication with local Electron app (127.0.0.1:4000)
  - WebSocket and HTTP calls gated and disabled
  
- **Page Interaction Telemetry**: Disabled by default
  - Scroll/click/form tracking requires explicit opt-in

### 7.2 If Re-Enabled in Future Builds
If we re-enable cloud features or external sync:
- **Updated Policy**: This privacy policy will be updated with clear disclosure
- **User Consent**: Explicit opt-in required before any data transmission
- **Encryption**: All network transmission will use HTTPS/WSS with modern cryptography (TLS 1.2+)
- **Manifest Update**: Chrome will prompt you to review new permissions

---

## 8. Children's Privacy

CoolDesk is not directed at children under 13. We do not knowingly collect personal information from children. If you believe a child has provided data, please contact us to delete it.

---

## 9. International Users

CoolDesk stores all data locally on your device. No data is transferred internationally. If cloud features are enabled in future builds, we will comply with GDPR, CCPA, and other applicable data protection laws.

---

## 10. Contact & Questions

- **Developer**: Raghu (abhayraghuwanshi/cooldesk-extension)
- **Support**: [Create an issue on GitHub](https://github.com/abhayraghuwanshi/cooldesk-extension/issues)
- **Email**: [Your contact email - to be added]

For privacy concerns, data deletion requests, or questions about this policy, please reach out via the channels above.

---

## 11. Policy Updates

We may update this Privacy Policy to reflect changes in functionality or legal requirements. Updates will be posted here with a new "Last Updated" date. Continued use of CoolDesk after updates constitutes acceptance of the revised policy.

---

## 12. Summary (TL;DR)

✅ **All data stays on your device** (Chrome local storage)  
✅ **No cloud sync or external transmission** (disabled in this build)  
✅ **No tracking, ads, or third-party sharing**  
✅ **Permissions used only for described features**  
✅ **You control your data** (delete anytime via UI or uninstall)  
✅ **Open source & transparent**  

**Your privacy is our priority.** CoolDesk is designed to enhance your productivity without compromising your data security.
