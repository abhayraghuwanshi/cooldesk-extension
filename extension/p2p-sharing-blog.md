# Building Real-Time P2P Collaboration in CoolDesk: A Technical Deep Dive

## Introduction

In today's distributed world, real-time collaboration is essential. CoolDesk, our browser extension, implements a powerful peer-to-peer (P2P) sharing system that enables teams to collaborate seamlessly without relying on centralized servers. This blog post explores how we built this feature using modern web technologies.

## Why P2P?

Traditional collaboration tools rely on centralized servers to sync data between users. While this works, it has several drawbacks:

- **Privacy concerns**: Your data passes through third-party servers
- **Single point of failure**: If the server goes down, collaboration stops
- **Latency**: Data must travel to the server and back
- **Costs**: Maintaining servers is expensive

P2P collaboration solves these issues by enabling direct communication between users, with end-to-end encryption ensuring data privacy.

## The Technology Stack

### Core Libraries

We use four powerful libraries to build our P2P infrastructure:

#### 1. **Yjs** - The Foundation
[Yjs](https://github.com/yjs/yjs) is a CRDT (Conflict-free Replicated Data Type) library that enables real-time collaboration. It automatically handles:
- Conflict resolution when multiple users edit simultaneously
- Data synchronization across peers
- Offline editing with automatic sync when reconnected

```bash
npm install yjs@^13.6.29
```

#### 2. **y-webrtc** - P2P Connectivity
[y-webrtc](https://github.com/yjs/y-webrtc) provides WebRTC-based peer-to-peer connectivity for Yjs documents. It handles:
- Peer discovery through signaling servers
- Direct P2P connections using WebRTC
- Automatic fallback to TURN servers for NAT traversal

```bash
npm install y-webrtc@^10.3.0
```

#### 3. **y-indexeddb** - Local Persistence
[y-indexeddb](https://github.com/yjs/y-indexeddb) stores Yjs documents in the browser's IndexedDB, providing:
- Offline access to shared data
- Instant loading on application restart
- Automatic synchronization with remote peers

```bash
npm install y-indexeddb@^9.0.12
```

#### 4. **crypto-js** - Cryptographic Functions
[crypto-js](https://github.com/brix/crypto-js) provides cryptographic utilities for:
- Key derivation (PBKDF2)
- Hashing (SHA-1)
- Encryption/Decryption (AES)

```bash
npm install crypto-js@^4.2.0
```

### Complete Installation

Install all dependencies at once:

```bash
npm install yjs@^13.6.29 y-webrtc@^10.3.0 y-indexeddb@^9.0.12 crypto-js@^4.2.0
```

### Package.json Example

Here's what your `package.json` should include:

```json
{
  "dependencies": {
    "yjs": "^13.6.29",
    "y-webrtc": "^10.3.0",
    "y-indexeddb": "^9.0.12",
    "crypto-js": "^4.2.0"
  }
}
```

### Additional Dependencies (Optional)

For awareness/presence features:

```bash
npm install y-protocols
```

This is typically included with y-webrtc, but you may need to import it explicitly:

```javascript
import { Awareness } from 'y-protocols/awareness';
```

## Architecture Overview

Our P2P system consists of three main components:

### 1. Storage Service (`storageService.js`)

Manages local data persistence using Yjs and IndexedDB:

```javascript
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

class P2PStorageService {
    constructor() {
        this.docs = new Map(); // teamId -> Y.Doc
        this.providers = new Map(); // teamId -> IndexeddbPersistence
    }

    async initializeTeamStorage(teamId) {
        // Create a Yjs document
        const ydoc = new Y.Doc();
        
        // Connect to IndexedDB for local persistence
        const provider = new IndexeddbPersistence(`team-db-${teamId}`, ydoc);
        
        this.docs.set(teamId, ydoc);
        this.providers.set(teamId, provider);
        
        // Wait for data to be loaded from IndexedDB
        await provider.whenSynced;
        
        return ydoc;
    }

    getSharedItems(teamId) {
        const doc = this.getDoc(teamId);
        return doc.getArray('shared-items'); // Y.Array for collaborative lists
    }

    getSharedMembers(teamId) {
        const doc = this.getDoc(teamId);
        return doc.getMap('team-members'); // Y.Map for collaborative objects
    }
}
```

**Key Features:**
- Each team has its own Yjs document
- Data is automatically persisted to IndexedDB
- Supports multiple data structures (Arrays, Maps)

### 2. Sync Service (`syncService.js`)

Handles P2P connections and real-time synchronization:

```javascript
import { WebrtcProvider } from 'y-webrtc';

class P2PSyncService {
    async connectTeam(teamId, encryptionKey) {
        // Initialize storage
        const ydoc = await p2pStorage.initializeTeamStorage(teamId);
        
        // Create WebRTC provider for P2P sync
        const provider = new WebrtcProvider(teamId, ydoc, {
            signaling: ['wss://your-signaling-server.com'],
            password: encryptionKey, // End-to-end encryption
            peerOpts: {
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        {
                            urls: 'turn:openrelay.metered.ca:80',
                            username: 'openrelayproject',
                            credential: 'openrelayproject'
                        }
                    ]
                }
            }
        });

        // Monitor peer connections
        provider.on('peers', (event) => {
            const peerCount = event.webrtcPeers?.length || 0;
            console.log(`Connected to ${peerCount} peer(s)`);
        });

        return provider;
    }
}
```

**Key Features:**
- WebRTC for direct P2P connections
- End-to-end encryption using shared passwords
- STUN/TURN servers for NAT traversal
- Real-time peer presence tracking

### 3. Team Manager (`teamManager.js`)

Manages team creation, joining, and member management.

## Team Creation & Joining: The Complete Flow

One of the most powerful features of CoolDesk's P2P system is how teams are created and joined. Unlike traditional systems that require server-side user management, CoolDesk uses a **secret phrase** system that's both secure and user-friendly.

### The Secret Phrase System

Instead of managing team IDs and encryption keys separately, CoolDesk uses a simple 4-word secret phrase that generates both:

1. **Room ID** (Discovery Key) - Used to find peers on the signaling server
2. **Encryption Key** - Used for end-to-end encryption

**Example secret phrase**: `alpha bravo charlie delta`

### How Key Derivation Works

Here's the cryptographic magic behind the scenes:

```javascript
import CryptoJS from 'crypto-js';

class P2PCryptoUtils {
    deriveKeys(secretPhrase) {
        // Normalize the secret (lowercase, trimmed)
        const normalizedSecret = secretPhrase.trim().toLowerCase();
        
        // 1. Generate Room ID (Discovery Key)
        // SHA-1 hash - safe to share with signaling server
        const roomId = CryptoJS.SHA1(normalizedSecret)
            .toString(CryptoJS.enc.Hex);
        
        // 2. Generate Encryption Key
        // PBKDF2 with 10,000 iterations for security
        const salt = 'cooldesk-p2p-salt-v1';
        const encryptionKey = CryptoJS.PBKDF2(normalizedSecret, salt, {
            keySize: 256 / 32,  // 256 bits
            iterations: 10000
        }).toString(CryptoJS.enc.Base64);
        
        return { roomId, encryptionKey };
    }
}
```

**Why this approach?**
- ✅ **User-friendly**: Remember one phrase instead of two complex strings
- ✅ **Secure**: PBKDF2 with 10,000 iterations resists brute-force attacks
- ✅ **Deterministic**: Same phrase always generates same keys
- ✅ **No server needed**: Everything is derived client-side

### Creating a Team (Step-by-Step)

When a user creates a new team, here's what happens:

```javascript
// 1. User provides team name and secret phrase
const teamName = "Project Alpha";
const secretPhrase = "alpha bravo charlie delta";

// 2. Derive keys from the secret phrase
const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

// 3. Create team object
const newTeam = {
    id: roomId,                    // Derived from secret
    name: teamName,                // User-friendly label
    secretPhrase: secretPhrase,    // Stored locally for convenience
    encryptionKey: encryptionKey,  // Derived and cached
    createdAt: Date.now(),
    createdByMe: true,             // This user is the admin
    lastSync: null
};

// 4. Save to local storage
await chrome.storage.local.set({ 
    cooldesk_teams: [...existingTeams, newTeam] 
});

// 5. Initialize P2P connection
await p2pSyncService.connectTeam(roomId, encryptionKey);
```

**What the creator needs to share**: Just the **secret phrase** (`alpha bravo charlie delta`)

### Joining an Existing Team

When another user wants to join the team:

```javascript
// 1. User receives the secret phrase from team creator
const secretPhrase = "alpha bravo charlie delta";  // Shared securely

// 2. User enters team name (local label) and secret phrase
const teamName = "Project Alpha";  // Can be different for each user

// 3. Derive the SAME keys (deterministic)
const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

// 4. Check if team already exists locally
const existingTeam = teams.find(t => t.id === roomId);
if (existingTeam) {
    console.log("Already a member of this team!");
    return existingTeam;
}

// 5. Create team object (createdByMe = false)
const joinedTeam = {
    id: roomId,
    name: teamName,
    secretPhrase: secretPhrase,
    encryptionKey: encryptionKey,
    createdAt: Date.now(),
    createdByMe: false,  // Not the admin
    lastSync: null
};

// 6. Save and connect
await chrome.storage.local.set({ 
    cooldesk_teams: [...existingTeams, joinedTeam] 
});
await p2pSyncService.connectTeam(roomId, encryptionKey);

// 7. Automatically sync with existing team members!
```

**Key Points**:
- Same secret phrase → Same room ID → Same team
- Users automatically find each other via the signaling server
- Data syncs immediately once connected
- No central server knows your data (only encrypted traffic)

### The Complete User Flow

#### For Team Creators:

1. **Open Settings** → Teams Tab
2. **Click "Join / Create"**
3. **Enter team name** (e.g., "Work Squad")
4. **Generate or enter secret phrase** (e.g., "nebula cosmic orbit solar")
5. **Click "Connect"**
6. ✅ Team created! You're the admin.
7. **Share the secret phrase** with team members (via secure channel)

#### For Team Members:

1. **Receive secret phrase** from team creator
2. **Open Settings** → Teams Tab
3. **Click "Join / Create"**
4. **Enter team name** (your local label)
5. **Enter the secret phrase** (exactly as shared)
6. **Click "Connect"**
7. ✅ Joined! You'll see existing team data and members.

### UI Implementation Example

Here's how CoolDesk implements the team creation/join form:

```javascript
function TeamCreationForm() {
    const [teamName, setTeamName] = useState('');
    const [secretPhrase, setSecretPhrase] = useState('');
    const [error, setError] = useState('');

    // Generate random 4-word secret
    const generateSecret = () => {
        const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 
                       'foxtrot', 'golf', 'hotel', 'nebula', 'cosmic', 
                       'orbit', 'solar', 'lunar', 'star'];
        const selection = [];
        for (let i = 0; i < 4; i++) {
            selection.push(words[Math.floor(Math.random() * words.length)]);
        }
        setSecretPhrase(selection.join(' '));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // Validate
        if (!teamName.trim() || !secretPhrase.trim()) {
            setError('Please enter both team name and secret phrase.');
            return;
        }

        const words = secretPhrase.trim().split(/\s+/);
        if (words.length < 4) {
            setError('Secret phrase must contain at least 4 words.');
            return;
        }

        try {
            // This works for both creating AND joining!
            await teamManager.addTeam(teamName, secretPhrase);
            
            // Clear form
            setTeamName('');
            setSecretPhrase('');
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div>
                <label>Team Name (Local Label)</label>
                <input
                    type="text"
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    placeholder="e.g. Work Squad"
                />
            </div>
            
            <div>
                <label>Secret Phrase (4+ words)</label>
                <button type="button" onClick={generateSecret}>
                    Generate Random
                </button>
                <input
                    type="text"
                    value={secretPhrase}
                    onChange={e => setSecretPhrase(e.target.value)}
                    placeholder="alpha bravo charlie delta"
                />
                <small>
                    This phrase generates encryption keys. 
                    Share it securely with your team.
                </small>
            </div>

            {error && <div className="error">{error}</div>}

            <button type="submit">Connect</button>
        </form>
    );
}
```

### Security Considerations

#### ✅ What's Secure:

1. **End-to-End Encryption**: Data encrypted with PBKDF2-derived key
2. **No Server Access**: Signaling server only sees encrypted traffic
3. **Strong Key Derivation**: 10,000 PBKDF2 iterations
4. **One-Way Hashing**: Room ID is SHA-1 hash (can't reverse to get secret)

#### ⚠️ What to Watch:

1. **Secret Phrase Strength**: Use random words, not common phrases
2. **Secure Sharing**: Share secret phrase via secure channels (Signal, in-person, etc.)
3. **Local Storage**: Secret phrase stored in browser storage (encrypted by browser)
4. **Brute Force**: 4 random words ≈ 40 bits of entropy (good, but not military-grade)

**Recommendation**: For sensitive data, use 6-8 random words instead of 4.

### Member Management

Once connected, the system automatically tracks team members:

```javascript
// When you connect, your info is broadcast via Awareness
awareness.setLocalStateField('user', {
    name: username,           // From user profile
    color: generateColor(),   // Random color for avatar
    isAdmin: createdByMe,     // True if you created the team
    lastSeen: Date.now()
});

// Other peers receive this and add you to the members list
p2pStorage.addMemberToTeam(teamId, {
    id: clientId.toString(),
    name: username,
    color: userColor,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    isAdmin: isAdmin
});
```

**Admin Privileges**:
- First person to create the team becomes admin
- Admin status is determined by `createdByMe` flag
- Currently, admins have the same permissions (future: admin-only actions)

### Viewing Team Members

```javascript
// Get all members (online and offline)
const members = p2pSyncService.getAllMembers(teamId);

// Members are sorted: online first, then by join date
members.forEach(member => {
    console.log(`${member.name} - ${member.isOnline ? 'Online' : 'Offline'}`);
    if (member.isAdmin) {
        console.log('  👑 Admin');
    }
});

// Get only online peers
const onlinePeers = p2pSyncService.getPeers(teamId);
console.log(`${onlinePeers.length} peers currently connected`);
```

### Leaving a Team

```javascript
async function leaveTeam(teamId) {
    // 1. Disconnect from P2P network
    p2pSyncService.disconnectTeam(teamId);
    
    // 2. Delete local database
    await p2pStorage.deleteTeamDatabase(teamId);
    
    // 3. Remove from team list
    await teamManager.removeTeam(teamId);
    
    console.log('Left team successfully');
}
```

**Important**: 
- Leaving deletes all local data
- Other members are unaffected
- You can rejoin anytime with the secret phrase
- If you're the admin, the team continues (no central authority)

## How It Works: Step-by-Step

### 1. Creating a Team

```javascript
// User provides friendly inputs
const teamName = "Project Alpha";
const secretPhrase = "alpha bravo charlie delta";

// System derives cryptographic keys
const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

// Create and save team
const team = await teamManager.addTeam(teamName, secretPhrase);

// Initialize P2P connection
await p2pSyncService.connectTeam(team.id, team.encryptionKey);
```

### 2. Joining a Team

```javascript
// Another user uses the SAME secret phrase
const secretPhrase = "alpha bravo charlie delta";

// Derives the SAME keys (deterministic)
const { roomId, encryptionKey } = cryptoUtils.deriveKeys(secretPhrase);

// Joins the team
await teamManager.addTeam("My Team Name", secretPhrase);

// Automatically connects to existing peers
await p2pSyncService.connectTeam(roomId, encryptionKey);
```

### 3. Sharing Data

```javascript
// Add an item to the shared workspace
const sharedItems = p2pStorage.getSharedItems(teamId);
sharedItems.push([{
    type: 'url',
    title: 'Important Document',
    url: 'https://example.com/doc',
    timestamp: Date.now()
}]);

// This change is automatically synced to all connected peers!
```

### 4. Real-Time Presence

```javascript
// Track who's online
const awareness = provider.awareness;

// Set local user info
awareness.setLocalStateField('user', {
    name: 'John Doe',
    color: '#3b82f6',
    lastSeen: Date.now()
});

// Listen for peer changes
awareness.on('change', ({ added, updated, removed }) => {
    console.log(`${added.length} peers joined`);
    console.log(`${removed.length} peers left`);
});
```

## Data Structures in CoolDesk

We use different Yjs data types for different purposes:

### Y.Array - For Ordered Lists
```javascript
// Shared workspace items (tabs, bookmarks)
const sharedItems = doc.getArray('shared-items');
sharedItems.push([item]); // Add item
sharedItems.delete(0, 1); // Remove first item

// Shared notices/announcements
const notices = doc.getArray('shared-notices');
```

### Y.Map - For Key-Value Data
```javascript
// Team context (goals, status, metadata)
const context = doc.getMap('team-context');
context.set('goal', 'Launch by Q2');
context.set('status', 'In Progress');

// Team members
const members = doc.getMap('team-members');
members.set(username, {
    id: clientId,
    name: username,
    color: userColor,
    isAdmin: false
});
```

## Security & Privacy

### End-to-End Encryption
All data is encrypted using the team's encryption key:

```javascript
const provider = new WebrtcProvider(teamId, ydoc, {
    password: encryptionKey // AES-GCM encryption
});
```

Only users with the correct encryption key can:
- Connect to the team
- Read shared data
- Make changes

### Signaling Server
The signaling server only facilitates peer discovery (SDP exchange). It:
- **Does NOT** see your data (encrypted)
- **Does NOT** store your data
- **Only** helps peers find each other

## Handling Network Challenges

### NAT Traversal
Many users are behind NAT/firewalls. We use:

1. **STUN servers**: Discover public IP addresses
2. **TURN servers**: Relay data when direct P2P fails

```javascript
iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
]
```

### Offline Support
Users can work offline and sync when reconnected:

```javascript
// IndexedDB stores data locally
const provider = new IndexeddbPersistence(`team-db-${teamId}`, ydoc);

// Changes made offline are queued
// When online, Yjs automatically syncs with peers
```

## Real-World Usage in CoolDesk

### 1. Shared Workspaces
Teams can share browser tabs and organize them collaboratively:

```javascript
// Share current tab with team
await p2pStorage.addItemToTeam(teamId, {
    type: 'tab',
    title: tab.title,
    url: tab.url,
    favicon: tab.favIconUrl,
    sharedBy: username,
    timestamp: Date.now()
});
```

### 2. Team Notice Board
Post announcements visible to all team members:

```javascript
const notices = p2pStorage.getSharedNotices(teamId);
notices.push([{
    title: 'Team Meeting',
    content: 'Tomorrow at 3 PM',
    author: username,
    timestamp: Date.now()
}]);
```

### 3. Team Context
Share project goals and status:

```javascript
const context = p2pStorage.getSharedContext(teamId);
context.set('currentGoal', 'Complete feature X');
context.set('projectStatus', 'On track');
context.set('deadline', '2026-02-01');
```

## Performance Considerations

### 1. Selective Syncing
Only connect to active teams to save bandwidth:

```javascript
// Connect only when user switches to team view
async function activateTeam(teamId) {
    if (!p2pSyncService.isConnected(teamId)) {
        await p2pSyncService.connectTeam(teamId, encryptionKey);
    }
}
```

### 2. Efficient Updates
Yjs uses delta-based synchronization:
- Only changes are transmitted, not entire documents
- Binary encoding for minimal bandwidth usage
- Automatic deduplication of updates

### 3. Memory Management
```javascript
// Disconnect when team is no longer active
async function deactivateTeam(teamId) {
    p2pSyncService.disconnectTeam(teamId);
    await p2pStorage.closeTeamStorage(teamId);
}
```

## Debugging & Monitoring

### Connection Status
```javascript
provider.on('status', (event) => {
    console.log('Connection status:', event.status);
    // 'connecting', 'connected', 'disconnected'
});
```

### Sync Status
```javascript
provider.on('synced', (event) => {
    if (event.synced) {
        console.log('✅ Fully synced with peers');
    } else {
        console.log('⚠️ Syncing in progress...');
    }
});
```

### Peer Monitoring
```javascript
provider.on('peers', (event) => {
    console.log(`Connected to ${event.webrtcPeers.length} peers`);
    
    // Check WebRTC connection states
    provider.room.webrtcConns.forEach((conn, peerId) => {
        console.log(`Peer ${peerId}:`, {
            connectionState: conn.peer?.connectionState,
            iceConnectionState: conn.peer?.iceConnectionState
        });
    });
});
```

## Common Pitfalls & Solutions

### 1. Peers Not Connecting
**Problem**: Users can't see each other

**Solutions**:
- Verify signaling server is accessible
- Check encryption keys match exactly
- Ensure TURN servers are configured for strict NATs
- Check browser console for WebRTC errors

### 2. Data Not Syncing
**Problem**: Changes don't appear for other users

**Solutions**:
- Verify `provider.synced` is true
- Check if IndexedDB persistence is initialized
- Ensure you're modifying the correct Yjs data structure
- Check for JavaScript errors in update handlers

### 3. Duplicate Members
**Problem**: Same user appears multiple times

**Solution**: Use username as the key instead of clientID:
```javascript
// Good: Use username as key
members.set(username, memberData);

// Bad: Use clientID (changes on reconnect)
members.set(clientId, memberData);
```

## Future Enhancements

1. **Conflict Resolution UI**: Visual indicators when conflicts occur
2. **Bandwidth Optimization**: Compress large data before sharing
3. **Selective Sync**: Choose which data types to sync
4. **Peer Reputation**: Track reliable peers for better connections
5. **Mobile Support**: Optimize for mobile browsers

## Conclusion

Building a P2P collaboration system might seem daunting, but with Yjs and y-webrtc, it's surprisingly straightforward. The combination of:

- **Yjs** for conflict-free data synchronization
- **y-webrtc** for P2P connectivity
- **y-indexeddb** for local persistence

...provides a robust foundation for real-time collaboration without centralized servers.

CoolDesk's P2P feature enables teams to share workspaces, collaborate on research, and stay synchronized—all while maintaining privacy and control over their data.

## Resources

- **Yjs Documentation**: https://docs.yjs.dev/
- **y-webrtc GitHub**: https://github.com/yjs/y-webrtc
- **WebRTC Basics**: https://webrtc.org/getting-started/overview
- **CoolDesk Repository**: [Your GitHub repo]

## Try It Yourself

Want to implement P2P sharing in your project? Here's a minimal example:

```javascript
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';

// 1. Create a Yjs document
const ydoc = new Y.Doc();

// 2. Add local persistence
const indexeddbProvider = new IndexeddbPersistence('my-app', ydoc);

// 3. Connect to peers
const webrtcProvider = new WebrtcProvider('my-room-name', ydoc, {
    signaling: ['wss://signaling.yjs.dev'],
    password: 'optional-encryption-key'
});

// 4. Use shared data structures
const sharedArray = ydoc.getArray('items');
sharedArray.push(['Hello, P2P world!']);

// 5. Listen for changes
sharedArray.observe(event => {
    console.log('Array changed:', sharedArray.toArray());
});
```

That's it! You now have a working P2P collaborative application.

---

**Questions or feedback?** Feel free to reach out or contribute to the CoolDesk project!
