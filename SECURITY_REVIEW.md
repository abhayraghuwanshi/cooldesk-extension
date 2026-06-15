# Security Review — CoolDesk (Tauri app + Chrome extension + P2P)

**Date:** 2026-06-11
**Scope:** Local sidecar server (port 4545), Chrome-extension ↔ Tauri sync, P2P team sync (y-webrtc), and the Cloudflare-worker paths used for signaling, categorization, and invite links.

> Framing: the assumption "it's all a local app and we only send a P2P link via a Cloudflare worker" is mostly true for the *network* surface — but it leaves two real threat models unaddressed:
> 1. **A malicious/compromised local process** running as the same user (the local server trusts everyone).
> 2. **Anyone who receives a shared invite/team link or guesses a team name** (the P2P credential flow leaks the real team secret).

---

## Severity summary

| # | Finding | Severity |
|---|---------|----------|
| 1 | Team-secret leaked through discovery-room approval | **Critical** |
| 2 | Local sidecar (4545) has no authentication | **High** |
| 3 | API key stored in plaintext on disk | **High** — ✅ fixed |
| 4 | Invite link embeds team secret, protected only by a short PIN | **High** |
| 5 | Weak P2P key derivation (static salt, low iterations, SHA-1 room id) | **Medium** |
| 6 | All sync data persisted unencrypted at rest | **Medium** |
| 7 | Worker request signature is replayable / body not signed (v1 path) | **Medium** |
| 8 | No rate limiting + 100 MB WS frames → local DoS | **Low** — ✅ fixed |

---

## 1. Team secret leaked via discovery-room approval — **Critical**

`src/services/p2p/requestService.js`

The "request to join" flow uses a **discovery room whose encryption key is the team *name*** (public, low-entropy):

```js
const normalizedTeamName = teamName.toLowerCase().replace(/\s+/g, '_');
const discoveryRoomId = `discovery_${normalizedTeamName}`;
await p2pSyncService.connectTeam(discoveryRoomId, normalizedTeamName); // key = team name
```

When an admin approves a request, the approval broadcast in that room **contains the actual team secret in cleartext**:

```js
const approval = {
    type: 'JOIN_APPROVED',
    teamSecret: teamData.secretPhrase,   // <-- the real secret
    ...
};
provider.awareness.setLocalStateField('joinApproval', approval);
```

Because the room is "encrypted" only with the guessable team name, **anyone who knows or guesses the team name can sit in the discovery room and harvest `teamSecret`**, which grants full read/write access to the team's data. The team name is exactly the kind of thing that gets shared casually ("join our *Marketing* team").

**Fix:** never transmit the long-term team secret over a name-keyed channel. Use an asymmetric handshake — requester sends a public key, admin encrypts the secret (or better, a per-member derived key) to that public key. The discovery room should carry only ephemeral, public handshake material.

---

## 2. Local sidecar server has no authentication — **High**

`src-tauri/src/sidecar/server.rs`, `handlers.rs`

The axum server on `127.0.0.1:4545` exposes the full data + control surface — `/workspaces`, `/urls`, `/tabs`, `/notes`, `/settings`, `/activity`, `/sync`, `/cmd/jump-to-tab`, the `/llm/*` cloud-proxy endpoints, and the `request-native-focus` WS command — with **no token, no signature, no per-request authorization**. A grep for `Authorization|Bearer|auth|token` across `handlers.rs` returns nothing.

The only access controls present are:
- A **CORS** layer restricting `Origin` to the extension ID + localhost.
- An `is_allowed_origin()` check on the WebSocket upgrade.

Both are **browser-enforced only**. CORS does not stop a non-browser client — `curl`, a script, or any malware running as the user — from calling these endpoints directly and getting a `200`. Worse, the WS origin check explicitly allows requests with no `Origin` header:

```rust
None => true, // Allow requests with no Origin (internal/native calls)
```

So any local process can:
- Read/exfiltrate all notes, URLs, tabs, workspaces, and activity history.
- Write/poison sync state (it's broadcast to every connected device).
- Drive OS window focus via `request-native-focus` / `/cmd/jump-to-tab`.
- Invoke `/llm/*`, spending the configured cloud API key (cost + data exfil through prompts).

**Fix:** require a shared secret the server generates at startup and hands to the legit clients (extension via `externally_connectable` / handshake, Tauri webview via injected token). Validate it on every HTTP request and WS message. Treat the `Origin`-less path as untrusted rather than trusted.

---

## 3. API key stored in plaintext on disk — **High** — ✅ FIXED (2026-06-11)

> **Resolved.** The cloud API key is now sealed at rest with Windows DPAPI
> (`CryptProtectData`, scoped to the current user account) in
> `src-tauri/src/sidecar/llm_v3/config.rs`. On disk the value is stored as
> `dpapi:v1:<base64>` and is no longer readable as plaintext. Changes are fully
> backward compatible: an existing plaintext key is decrypted into memory on load
> and automatically re-saved in encrypted form (one-time migration), so no key is
> lost and no re-entry is required. Encrypt/decrypt are infallible from the
> caller's side — any crypto error falls back to the previous behaviour rather
> than locking the user out of cloud AI. Non-Windows builds are unchanged.
> Verified with `cargo check` and a DPAPI round-trip unit test (`cargo test`).
>
> Original finding, for reference:



`src-tauri/src/sidecar/llm_v3/config.rs`

```rust
fn config_path() -> PathBuf {
    let cwd = std::env::current_dir()...;
    cwd.join("sync-data").join("cloud_config.json")
}
```

The OpenAI/Anthropic API key is written to `sync-data/cloud_config.json` as plaintext JSON. `v3_get_config` masks it for *display*, but the file on disk is unprotected and lives under the working directory (easy to accidentally include in backups, logs, or a packaged build). Any process running as the user reads it directly.

**Fix:** store the key in the OS credential vault (Windows Credential Manager / DPAPI via `keyring` crate), not a plaintext file. At minimum, restrict file ACLs and keep it out of any synced/backed-up directory.

---

## 4. Invite link embeds the team secret, protected only by a short PIN — **High**

`src/components/popups/InviteUserModal.jsx`, `src/App.jsx`, `cryptoUtils.encryptWithPin`

The "Secure PIN Invite" builds a link of the form:

```
index.html?invite=<AES-CBC( {name, secret}, PBKDF2(PIN, salt, 10000) )>
```

The **full long-term team secret** is embedded in the URL, encrypted only with a user-chosen PIN that the UI allows to be **4 characters** (and the placeholder/UX nudges toward 4 numeric digits). A 4-digit PIN is 10,000 candidates; 10,000 PBKDF2 iterations does not meaningfully slow an offline attacker who intercepts the link (forwarded message, chat history, clipboard manager, proxy logs). Cracking is seconds of work, after which they hold the real team secret forever.

**Fix:** don't put the persistent secret in shareable links. Use a single-use, server-issued (or time-boxed) invite token that maps to the team server-side, or the asymmetric handshake from #1. If a PIN-wrapped link is kept, enforce a high-entropy PIN and a much higher KDF cost (Argon2id / ≥600k PBKDF2), and make invites expire.

---

## 5. Weak P2P key derivation — **Medium**

`src/services/p2p/cryptoUtils.js` — `deriveKeys()`

```js
const roomId = CryptoJS.SHA1(normalizedSecret)...;          // SHA-1
const salt = 'cooldesk-p2p-salt-v1';                        // static, app-wide
const encryptionKey = CryptoJS.PBKDF2(normalizedSecret, salt, { iterations: 10000 });
```

Three issues:
- **Static, hardcoded salt** shared by every user → enables precomputation/rainbow tables against the whole user base and removes any per-user work factor.
- **10,000 iterations** is low for 2026; brute-forcing a weak 4-word secret is cheap.
- **Room id and encryption key are both derived from the same secret** with public parameters. The room id is necessarily visible to the signaling worker, so the only thing standing between an observer and the E2EE key is the secret's entropy. SHA-1 for the room id is also deprecated.

The y-webrtc `password` (used as the E2EE room password in `syncService.js`) inherits all of this — confidentiality rests entirely on secret strength.

**Fix:** per-team random salt distributed with the team; Argon2id or PBKDF2 with ≥600k iterations; derive room-id and encryption-key from *separate* sub-keys (HKDF with distinct info labels) so exposing the discovery id leaks nothing about the key; move off SHA-1.

---

## 6. All sync data persisted unencrypted at rest — **Medium**

`src-tauri/src/sidecar/storage.rs`

`sync-data/sync-data.json` holds every note, URL, workspace, tab, and activity record in plaintext. Combined with #2 (no local auth) and #3 (key in the same folder), the entire `sync-data/` directory is a single, unprotected loot target for any local process or backup scrape.

**Fix:** encrypt the data file with an OS-vault-held key, or document explicitly that at-rest protection relies on OS disk encryption + file ACLs and lock those down.

---

## 7. Worker request signature is replayable / incomplete — **Medium**

`src/services/cloudflareService.js`

`fetchWithAuth` signs only `"<method>:<url>:<timestamp>"`:

```js
const payloadString = `${method}:${fullUrl}:${timestamp}`;
```

- The **request body is not signed**, so a man-in-the-middle (or the worker itself, or a logging proxy) can tamper with the JSON body without invalidating the signature.
- There is **no nonce** on this path and no evidence the worker rejects stale timestamps, so captured requests are replayable.

(The newer `categorizeBatch` path via `CryptoUtils.signRequest` is better — it includes a nonce and signs the canonical body. That pattern should be used everywhere.)

**Fix:** sign `timestamp + nonce + canonical(body)` on every authenticated worker call; enforce a timestamp window and single-use nonce server-side.

---

## 8. No rate limiting + 100 MB WS frames — **Low (local DoS)** — ✅ FIXED (2026-06-11)

`src-tauri/src/sidecar/server.rs`

> **Resolved.** Three bounded, non-breaking limits were added:
> - **Frame size** reduced `100 MB → 32 MB` (`WS_MAX_PAYLOAD`). Still far above any
>   real batched-JSON sync payload, but caps single-frame memory.
> - **Concurrent connection cap** of 64 (`WS_MAX_CONNS`) enforced with an RAII
>   guard (`WsConnGuard`) that releases its slot on drop, so a failed or closed
>   upgrade can't leak a slot. Legit usage is a handful of connections.
> - **Per-connection inbound rate limit** of 100 msg/s (`WS_MAX_MSGS_PER_SEC`),
>   fixed-window. Excess is dropped rather than closing the socket, so a normal
>   client (which batches pushes and never approaches the ceiling) is never
>   disconnected; only a flood is throttled.
>
> Verified with `cargo check`.
>
> Original finding, for reference:

No connection or message rate limiting anywhere on the sidecar. A local client can open many sockets or push 100 MB frames to exhaust memory. Lower-impact than the above (local-only), but worth a cap once #2 is fixed.

---

## What is actually fine

- **CORS / origin allow-list** is a reasonable defense-in-depth against *browser-based* cross-origin calls (it just can't be the only control — see #2).
- The **admin ECDSA signature verification** in `syncService.js` (validating an admin claim against a published public key before trusting `isAdmin`) is sound in principle.
- The **"Copy Link Only" invite mode** (name only, secret shared out-of-band) does not leak credentials in the link.
- `categorizeBatch`'s **nonce + canonical-body signing** is the right model.
- Binding the server to `127.0.0.1` (not `0.0.0.0`) correctly keeps it off the network.

---

## Recommended priority order

1. **#1** — stop broadcasting `teamSecret` in the name-keyed discovery room (asymmetric handshake).
2. **#2** — add a startup-generated auth token to the 4545 server; stop trusting `Origin`-less requests.
3. **#3** — move the API key to the OS credential vault.
4. **#4** — replace secret-bearing invite links with single-use/expiring tokens; raise KDF cost if PIN links stay.
5. **#5 / #6 / #7** — strengthen KDF + salting, encrypt data at rest, sign request bodies with a nonce.
