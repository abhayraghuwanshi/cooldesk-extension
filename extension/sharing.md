Here is your **Client-Side WebSocket API Cheat Sheet**. Use this as a reference when building your React/Frontend components.

### 1\. Connection Setup

**Endpoint:**
`wss://<YOUR_WORKER_URL>?teamId=<TEAM_ID>&userId=<USER_ID>`

  * **`teamId`**: The identifier for the workspace (e.g., `team-alpha`).
  * **`userId`**: The unique ID of the current user (e.g., from your Auth provider).

-----

### 2\. Outgoing Events (Client $\rightarrow$ Server)

Send these JSON objects using `ws.send(JSON.stringify(payload))`.

#### A. Folder Management

| Action | Payload Structure | Notes |
| :--- | :--- | :--- |
| **Create Folder** | `{ "type": "CREATE_FOLDER", "name": "Design", "parentId": "optional-id" }` | Send `parentId: null` for root level. |
| **Delete Folder** | `{ "type": "DELETE_FOLDER", "folderId": "xyz-123" }` | Fails if folder is not empty or user is not owner/admin. |

#### B. Item (URL) Management

| Action | Payload Structure | Notes |
| :--- | :--- | :--- |
| **Add URL** | `{ "type": "ADD_URL", "url": "https://google.com", "title": "Google", "folderId": "optional-id" }` | `folderId` is optional. |
| **Move Item** | `{ "type": "MOVE_ITEM", "itemId": "abc-123", "targetFolderId": "xyz-789" }` | Used for **Drag and Drop**. Send `targetFolderId: null` to move to root. |
| **Delete Item** | `{ "type": "DELETE_ITEM", "itemId": "abc-123" }` | Fails if user is not owner/admin. |

#### C. Team & Permissions

| Action | Payload Structure | Notes |
| :--- | :--- | :--- |
| **Generate Invite** | `{ "type": "CREATE_INVITE" }` | **Admins only.** Generates a code valid for 24h. |
| **Join Team** | `{ "type": "JOIN_TEAM", "code": "A1B2C3" }` | Upgrades the current user to `editor`. |

-----

### 3\. Incoming Events (Server $\rightarrow$ Client)

Handle these inside `ws.onmessage`.

#### A. The "Main" Sync Event

This triggers immediately on connection and after *any* change by *any* user.
**Event:** `SYNC_STATE`

```json
{
  "type": "SYNC_STATE",
  "folders": [
    { "id": "f1", "name": "Work", "parent_id": null, "added_by": "user_1" },
    { "id": "f2", "name": "Docs", "parent_id": "f1", "added_by": "user_2" }
  ],
  "items": [
    { "id": "i1", "url": "google.com", "folder_id": "f1", "added_by": "user_1" }
  ]
}
```

  * **Dev Tip:** The data comes flat. You likely need a utility function to convert this into a Tree structure for your UI.

#### B. Feedback & Errors

**Event:** `ERROR`
Triggered when a permission check fails (e.g., trying to delete someone else's link).

```json
{
  "type": "ERROR",
  "message": "Permission Denied: You can only delete items you added."
}
```

  * **UI Action:** Show a Red Toast / Snackbar notification.

#### C. Admin Responses

**Event:** `INVITE_GENERATED`
Response to `CREATE_INVITE`.

```json
{
  "type": "INVITE_GENERATED",
  "code": "X7K9P2"
}
```

  * **UI Action:** Display a modal: "Copy this code to invite your team."

**Event:** `JOINED_SUCCESS`
Response to `JOIN_TEAM`.

```json
{
  "type": "JOINED_SUCCESS",
  "role": "editor"
}
```

  * **UI Action:** Unlock UI features (enable drag/drop) and show "You have joined the team\!"

-----

### 4\. Recommended React Hook Structure

To keep your code clean, I recommend wrapping this logic in a custom hook:

```javascript
// useTeamSync.js
import { useState, useEffect, useRef } from 'react';

export const useTeamSync = (teamId, userId) => {
    const [folders, setFolders] = useState([]);
    const [items, setItems] = useState([]);
    const ws = useRef(null);

    useEffect(() => {
        ws.current = new WebSocket(`wss://YOUR_URL?teamId=${teamId}&userId=${userId}`);
        
        ws.current.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'SYNC_STATE') {
                setFolders(msg.folders);
                setItems(msg.items);
            }
            if (msg.type === 'ERROR') {
                alert(msg.message); // Replace with Toast
            }
            // ... handle others
        };

        return () => ws.current.close();
    }, [teamId, userId]);

    const addUrl = (url, title, folderId) => {
        ws.current.send(JSON.stringify({ type: "ADD_URL", url, title, folderId }));
    };
    
    // ... expose other functions ...

    return { folders, items, addUrl /* ... */ };
};
```