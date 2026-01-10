### **Overview of the P2P Architecture**

* **Discovery (DHT):** We use a 4-word "Team Secret" to generate a unique 20-byte info hash. This acts as the "address" in the public phone book (DHT), allowing peers to find each other's IPs without a central server.
* **Access (Encryption):** Once peers connect via the DHT-found IPs, they use a derived symmetric key to encrypt all synchronized data.
* **Data Consistency (CRDTs):** We use **Yjs** with **Y-IndexedDB** to ensure data is merged correctly (no "Data Wars") and persists locally even if the browser is closed.

---

### **Step-by-Step Implementation Plan**

#### **1. Core Configuration & Multi-Team Handling**

* **Team Secret Logic:** Create a utility to convert user-friendly 4-word keys into two separate cryptographic keys:
1. **Discovery Key:** A SHA-1 hash of the secret, used as the room name for WebRTC/DHT.
2. **Encryption Key:** A PBKDF2 derived key for AES-256 encryption of the shared database.


* **Team Switcher UI:** Build a sidebar in the "Settings" or "Teams" view that stores an array of team objects in `chrome.storage.local`. Each object contains the team name, secret, and last sync timestamp.

#### **2. Local Data Persistence (IndexedDB)**

* **Library:** Use `y-indexeddb`.
* **Implementation:** * For every active team, initialize a separate IndexedDB instance named `team-db-[team-id]`.
* Attach the Yjs `IndexeddbPersistence` to the team's `Y.Doc`.
* **Result:** Data is saved instantly to the local disk. When the user reopens the extension, the "IR List" loads immediately from the disk before even trying to find peers.



#### **3. P2P Data Sync (Yjs + WebRTC)**

* **Provider:** Use `y-webrtc`.
* **Serverless Setup:** While `y-webrtc` typically uses a signaling server, we can point it to a pool of public STUN/TURN servers (like Google’s) to facilitate the NAT traversal.
* **Sync Logic:**
* When the extension starts, it "joins" the rooms for all active teams.
* Yjs automatically handles the "Sync Step 1 & 2" (diffing) between peers as soon as the WebRTC connection is established.



#### **4. API for Sharing URLs (Peer-to-Peer "Send")**

* **The "Share URL" Feature:** Instead of a cloud link, generate a `magnet:` link or a custom extension protocol link (e.g., `p2p-sync://team-secret`).
* **Direct Send:**
* When a user "Shares" a specific URL or item, it is added to a special `Y.Array` in the shared document.
* All connected peers receive an `observe` event and a browser notification: *"New link shared by [User Name]"*.



#### **5. DHT "Discovery" Layer (WebTorrent)**

* **Library:** `webtorrent` (npm install).
* **Function:** Use the WebTorrent client to "seed" a tiny metadata file (the Team ID) to the global DHT.
* **Peer Discovery:** When the WebTorrent DHT finds a peer with the same info hash, it passes that peer's IP/ID to the Yjs WebRTC provider to initiate the high-speed data sync.

---

### **Implementation Roadmap**

| Milestone | Task | Technology |
| --- | --- | --- |
| **Phase 1: Storage** | Implement `chrome.storage.local` for team settings and `IndexedDB` for IR lists. | Y-IndexedDB / Web API |
| **Phase 2: Identity** | Create the "4-word key" generator and local username setup in Settings. | Crypto API / lucide-react |
| **Phase 3: Network** | Integrate `y-webrtc` to enable live syncing between two open browser tabs. | Yjs / WebRTC |
| **Phase 4: Discovery** | Use `webtorrent` to allow peers to find each other across different networks via DHT. | WebTorrent / DHT |
| **Phase 5: UI** | Build the "Cooldesk" dashboard with multi-team tabs and a "Shared URL" feed. | Tailwind / React |

### **Enterprise Security Checklist**

1. **E2EE:** Ensure the `password` field in `WebrtcProvider` is set using the derived Encryption Key.
2. **Sovereignty:** Add a "Purge Local Data" button in Settings to wipe the IndexedDB.
3. **Audit:** Store a local "Change Log" in a separate `Y.Map` to see who made which edits.


