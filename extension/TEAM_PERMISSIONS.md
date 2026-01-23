# Team Permissions & Security Model

## Overview
Cooldesk uses a decentralized, Peer-to-Peer (P2P) architecture. Unlike traditional apps with a central server, permissions are enforced through **Cryptography** and **Local Authority**.

There are 3 distinct roles in a team:

---

### 1. 👑 Admin (Owner)
**Who is this?**
- The person who **created** the team.
- The ONLY person who holds the **Private Key** (generated on their device at creation time).

**Capabilities:**
- ✅ **Full Write Access**: Add, move, delete notes/images/stickers.
- ✅ **Manage Members**: Can promote members to "Writer" or demote them to "Viewer".
- ✅ **Generate Invites**: Create secure PIN invites.
- ✅ **Sign Capabilities**: Since they hold the Private Key, they are the only ones who can digitally sign permissions for others.

**Security:**
- Their status is proven by signing their own presence (ClientID) with their Private Key.
- If they lose their device/storage, the Private Key is lost, and Admin powers cannot be recovered (a new team must be created).

---

### 2. ✍️ Writer (Full Access Member)
**Who is this?**
- A team member who has been **explicitly granted** write access by the Admin.
- Their permission is "leased" via a digital signature.

**Capabilities:**
- ✅ **Write Access**: Can add, move, delete notes/images/stickers.
- ❌ **Cannot Manage Members**: Cannot promote/demote others.
- ❌ **Cannot Delete Team**: Cannot destroy the workspace.

**Security:**
- To be a Writer, they must have a valid `writerSignature` in the shared database.
- This signature says *"Admin approves [Username] to write"*.
- The signature is verified by every peer’s client. If they try to fake it, the signature won't match the Admin's Public Key, and they will be blocked.

---

### 3. 👁️ Viewer (Read-Only)
**Who is this?**
- The **Default Role** for anyone joining via an invite link.
- Users who have not been granted special permissions.

**Capabilities:**
- ✅ **Real-Time Sync**: Sees all changes instantly.
- ✅ **Cursor Presence**: Can be seen moving around by others.
- ❌ **No Write Access**: Cannot move items, add notes, or delete anything.

**Security:**
- Their client is forced into "Read-Only" mode. synchronizes data but disables all editing UI tools.

---

## Technical Security Implementation

### The "Trust vs. Math" Upgrade
Previously, the system relied on "Social Trust" (if you have the password, you are trusted). We have upgraded this to **Cryptographic Enforcement**.

| Feature | Old System (Trust-Based) | New System (Crypto-Based) |
|:---|:---|:---|
| **Admin Proof** | "First person to join is Admin" (Flawed) | **Digital Signature**: Must sign ClientID with Private Key. |
| **Writer Proof** | Simple `isWriter: true` flag (Spoofable) | **Signed Capability**: Must have valid `writerSignature` from Admin. |
| **Invite Link** | Gave implicit Admin rights | Defaults to `createdByMe: false` (Viewer). |

### Failure Modes
- **Hacked Client**: If a malicious user modifies their code to ignore permissions, they can *try* to send updates. However, strict peers *should* reject updates from non-signed writers (future enhancement). Currently, the UI protections prevent 99% of accidental/casual misuse.
- **Stolen Secret Phrase**: If someone steals the Team Secret, they can join the team. **BUT**, they will join as a **Viewer**. They cannot hijack Admin status because they don't have the Admin's locally stored Private Key.
