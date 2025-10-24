# CoolDesk – Dropbox Integration Guide

## Overview

This document explains how to integrate Dropbox into the **CoolDesk Chrome extension** to enable **syncing user collections across devices** without a backend.

Key features:

* OAuth2 authentication for Dropbox (App Folder, Scoped Access)
* Upload / download JSON collections
* Offline support using IndexedDB
* Optional auto-sync and merge logic

---

## 1. Dropbox App Setup

1. Go to [Dropbox Developer Console](https://www.dropbox.com/developers/apps).
2. Click **“Create App”**.

   * **Scoped access** → App folder (recommended)
   * Name: `CoolDeskSync`
3. Note the following:

   * **App key** → `YOUR_APP_KEY`
   * **App secret** → Keep private; not needed for frontend-only OAuth
4. **OAuth Redirect URI:**

   * Chrome extensions cannot use `extension://`
   * Use `chrome.identity.getRedirectURL('dropbox')` → `https://<extension-id>.chromiumapp.org/dropbox`
   * Add this URI in Dropbox app settings under Redirect URIs.
5. Enable **Allow public clients (Implicit Grant & PKCE)**.

---

## 2. Install Dropbox SDK

Using npm:

```bash
npm install dropbox
```

Or include via CDN in your extension popup/options page:

```html
<script src="https://unpkg.com/dropbox/dist/Dropbox-sdk.min.js"></script>
```

---

## 3. OAuth2 Authentication (Chrome Extension)

Use `chrome.identity.launchWebAuthFlow` for authentication:

```js
import { Dropbox } from 'dropbox';

const APP_KEY = 'YOUR_APP_KEY';

function connectDropbox() {
  const dbx = new Dropbox({ clientId: APP_KEY });
  const redirectUri = chrome.identity.getRedirectURL('dropbox'); // registered in Dropbox
  const authUrl = dbx.auth.getAuthenticationUrl(
    redirectUri,
    null,
    'token', // Implicit Grant
    'none',
    null,
    'none',
    true
  );

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    redirectUrl => {
      if (chrome.runtime.lastError) return console.error(chrome.runtime.lastError);
      const params = new URLSearchParams(redirectUrl.split('#')[1]);
      const accessToken = params.get('access_token');
      chrome.storage.local.set({ dropboxToken: accessToken });
      console.log('✅ Dropbox connected!');
    }
  );
}
```

* Store the token securely in `chrome.storage.local`.
* Add a UI button: **[Connect Dropbox]**.

---

## 4. Upload / Download JSON Collections

### Upload (push local data to Dropbox)

```js
async function uploadCollections(data) {
  const tokenObj = await chrome.storage.local.get('dropboxToken');
  const token = tokenObj.dropboxToken;
  if (!token) return;

  const dbx = new Dropbox({ accessToken: token });
  await dbx.filesUpload({
    path: '/collections.json', // stored in App Folder automatically
    contents: JSON.stringify(data),
    mode: { '.tag': 'overwrite' }
  });
}
```

### Download (pull latest data from Dropbox)

```js
async function downloadCollections() {
  const tokenObj = await chrome.storage.local.get('dropboxToken');
  const token = tokenObj.dropboxToken;
  if (!token) return null;

  const dbx = new Dropbox({ accessToken: token });
  const res = await dbx.filesDownload({ path: '/collections.json' });
  const text = await res.fileBlob.text();
  return JSON.parse(text);
}
```

---

## 5. Merge / Sync Logic

* Store **timestamps** for `updatedAt` and `lastSyncedAt` in collections.
* On sync:

```js
if (remote.updatedAt > local.updatedAt) {
  applyRemote(remote);
} else {
  await uploadCollections(local);
}
```

* Optional: debounce uploads every few seconds to reduce API calls.

---

## 6. Offline Support

* Keep collections in **IndexedDB** locally.
* Sync with Dropbox only when online + authenticated.
* Use flags like `dirty: true/false` to detect local changes.

---

## 7. Optional Features

* **Auto-sync**: every 5–10 minutes
* **AES Encryption** for privacy

```js
const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), userPassword).toString();
```

* **Shared Folder Support**: users can collaborate by sharing `/Apps/cooldesk-storage/` folder.

---

## 8. UI Recommendations

* Button: **Connect Dropbox** → start OAuth
* Button: **Sync Now** → force upload/download
* Display: **Last synced timestamp**
* Status: ✅ Connected / ❌ Not connected

---

## 9. Testing Checklist

| Test                     | Expected Result                                   |
| ------------------------ | ------------------------------------------------- |
| Connect Dropbox          | Token stored locally                              |
| Upload data              | `/Apps/cooldesk-storage/collections.json` created |
| Download data            | Collections restored correctly                    |
| Offline edit + reconnect | Changes synced                                    |
| Shared folder            | Collaboration works                               |

---

## 10. Folder Structure (Suggested)

```
/src
  ├─ dropbox/
  │   ├─ auth.js         # OAuth + token storage
  │   ├─ sync.js         # Upload / download / merge logic
  ├─ db/
  │   ├─ localStore.js   # IndexedDB logic
  ├─ ui/
  │   ├─ settings.js     # Buttons for Connect / Sync
```

---
