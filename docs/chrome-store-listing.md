# Chrome Web Store listing

Copy for the CWS developer dashboard. Every claim here is checked against
`manifest.json` (v2.0.6) and shipped code — see "What was cut and why" at the
bottom before editing.

---

## Name

```
New Tab by CoolDesk
```

> Must match `manifest.json` `name` exactly. Current manifest says
> `New Tab by Cooldesk` (lowercase d) — pick one spelling and sync both.

## Short description (132 char max)

```
Replace your new tab with your saved workspaces, open tabs, and recent activity — plus instant search across all of them.
```

*(119 characters)*

## Category

Productivity → Workflow & Planning

## Single purpose statement

```
CoolDesk replaces the new tab page with a dashboard of the user's saved
workspaces, currently open tabs, and recent browsing activity, with a search
box that finds any of them.
```

---

## Detailed description

```
CoolDesk turns the blank new tab page into a view of what you're actually
working on — your saved projects, every tab you have open, and where you've
just been.

Open source. No account required. No sign-up.


WHAT YOU GET ON EVERY NEW TAB

Saved Workspaces
Group links and tabs into named projects. Pin the ones you live in — pinned
workspaces stay at the top, and the rest sort by most recent activity, so the
project you touched an hour ago is the one you see.

Open Tabs
Every tab across every window in a single view, grouped by Chrome's native tab
groups and showing their colors. Find the tab you lost without squinting at
favicons.

Activity Feed
What you visited recently, organized by workspace, so picking a project back up
doesn't start with "where was I?"

Quick Search
One box that searches your saved links, open tabs, workspaces, bookmarks, and
browser history together. Start typing and hit Enter — you never leave the page.

Widgets
Optional cards for the new tab: weather, currency rates, crypto prices, and
Wikipedia lookup. Add only the ones you want.

Wallpapers
Set a background from Unsplash or use your own.


OPTIONAL DESKTOP COMPANION (Windows and macOS)

CoolDesk also ships a free, open-source desktop app. The extension works fully
on its own — the app is for people who want their desktop apps in the same view
as their tabs.

  Workspaces (Ctrl+1) — your saved collections, with visit counts and last
  activity.

  Tabs & Running Apps (Ctrl+2) — open browser tabs and running desktop
  applications in one unified, searchable grid. Switch to either without
  Alt+Tabbing.

  Spotlight — one global shortcut to search and launch tabs, workspaces, apps,
  and history from anywhere on your desktop.

When the app is running, the extension syncs with it over your local machine
only (localhost, port 4545). Nothing about that sync leaves your computer.

Get it at cool-desk.com — it's free.


PRIVACY

Your workspaces, tabs, activity, and searches are stored in your browser's local
storage and are not uploaded. Search and suggestions run on your device.

CoolDesk contacts outside servers only for the specific features that need it:

  • Unsplash — only when you pick a wallpaper
  • Open-Meteo, Frankfurter, CoinGecko, Wikipedia — only for the matching widget,
    if you add it
  • Link previews — when you save a link, we fetch that page to read its title
    and preview image
  • cool-desk.com — only if you browse or publish community workspace templates

We do not sell your data, we do not use ad or analytics trackers, and we do not
transfer your browsing data to third parties.

Full policy: https://cool-desk.com/privacy-details


OPEN SOURCE

Read the code, file an issue, or self-host:
https://github.com/abhayraghuwanshi/cooldesk-extension


LINKS

Release notes:        https://cool-desk.com/releases
Community workspaces: https://cool-desk.com/search
How to use:           https://cool-desk.com/how-to-use
```

---

## Permission justifications

Every permission in `manifest.json` needs one of these in the **Privacy
practices** tab. Missing or vague justifications are the single most common
rejection reason.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's workspaces, saved links, widget layout, and settings locally in the browser. |
| `tabs` | The new tab page lists the user's open tabs so they can find and switch to one. Requires tab titles and URLs. |
| `tabGroups` | Displays open tabs grouped under their Chrome tab group names and colors, matching what the user already set up. |
| `windows` | Tabs are collected across all open windows, not just the current one, and switching to a tab may require focusing its window. |
| `history` | Quick Search searches the user's browser history alongside saved links and tabs. |
| `bookmarks` | Quick Search searches the user's bookmarks alongside saved links and tabs. |
| `topSites` | Populates suggested shortcuts on a newly installed new tab page before the user has saved anything. |
| `sessions` | Offers recently closed tabs so the user can restore one from the new tab page. |
| `search` | Submits the user's query to their configured default search engine when a Quick Search query matches nothing local. |
| `idle` | Pauses activity timing when the machine is idle, so time-on-page in the activity feed is not inflated. |
| `alarms` | Schedules periodic refresh of widget data and cleanup of stored activity records. |
| `scripting` | Injects the page-preview reader used to capture a page's title and preview image when the user saves a link. |
| `activeTab` | Lets the user save the current page to a workspace from the extension's toolbar action. |
| `host_permissions` (`http://*/*`, `https://*/*`) | Two content scripts measure how long the user actively spends on the pages they visit, which powers the activity feed and orders workspaces by recency. This runs on any site the user chooses to visit, so it cannot be limited to a fixed list. |

### Data-use disclosures to check in the dashboard

Based on what the code actually collects, declare:

- **Web browsing activity** — yes. The content scripts record URL, dwell time,
  scroll depth, click/keypress counts, and form-submission counts.
- **User activity** — yes, for the same reason.
- **Website content** — yes. Link previews read `<title>` and Open Graph tags
  from saved pages.
- Authentication info, personal comms, financial, health, location, PII — no.

Then certify all three: no sale of data, use limited to the single purpose
above, no creditworthiness/lending use.

---

## What was cut and why

The previous draft described features that are not in the shipped build.
Shipping it would be a "listing does not match functionality" rejection.

**Cut: "Team Spaces (Ctrl+3)"**
`src/config/features.js` sets `TEAM_FEATURE_ENABLED = false`, and
`src/components/spatial/WorkspaceShell.jsx:9` reads:
```js
const DESKTOP_FACES = TEAM_FEATURE_ENABLED ? ['workspace', 'tabs', 'team'] : ['workspace', 'tabs'];
```
The team face, `/team` commands, and the Settings tab are all hidden. There is
no Ctrl+3.

**Cut: "Notes (Ctrl+4)"**
The standalone Notes face was removed; notes now live inside
`WorkspaceContextPanel.jsx` as part of a workspace. No Ctrl+4 binding exists.

**Changed: "four navigation panels" → two**
The shipped desktop app has two faces, Ctrl+1 and Ctrl+2, per `DESKTOP_FACES`
above and `src/App.jsx:1233`.

**Rewritten: "Nothing is sent to external servers"**
This is the highest-risk claim in the draft — it is contradicted by the
extension's own CSP, which allows `connect-src` to `api.unsplash.com`,
`api.open-meteo.com`, `api.coingecko.com`, `api.frankfurter.app`, and
`en.wikipedia.org`. Beyond that:
- `src/services/cloudflareService.js` makes signed requests to
  `https://cool-desk.raghuwanshi-abhay405.workers.dev` carrying a user ID.
- `background.js` `fetchPreview` fetches arbitrary user-supplied URLs.
- `chrome.runtime.setUninstallURL` opens `cool-desk.com/uninstall` on removal.
- Both content scripts run on `<all_urls>` and record interaction metrics.

An absolute "nothing leaves your device" claim next to that code is a privacy
misrepresentation, which is a removal-grade violation rather than a simple
rejection. The rewrite keeps the local-first message but enumerates the
exceptions.

**Changed: "Windows desktop app" → "Windows and macOS"**
The draft said "Windows and Mac" in the heading and "the Windows desktop app"
in the call to action. The app ships for both.

**Removed: paid framing**
The draft's "The Chrome extension is free. The Windows desktop app unlocks the
full four-panel experience" implies a paid upgrade. The desktop app is free and
open source; "unlocks" invites a digital-goods/payments compliance question that
has no reason to come up.
```
