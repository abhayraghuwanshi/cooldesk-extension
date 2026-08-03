/**
 * Canonical address of the local sidecar (the axum server inside the Tauri app).
 *
 * Use `127.0.0.1`, never `localhost`. The Rust side binds a literal IPv4
 * address — `TcpListener::bind("127.0.0.1:4545")` in
 * `src-tauri/src/sidecar/server.rs` — while `localhost` resolves through the
 * OS, and on Windows it commonly answers `::1` (IPv6) first. A client that
 * says `localhost` can therefore dial an address nothing is listening on and
 * fail with ECONNREFUSED while the sidecar is running perfectly well. The
 * extension manifest whitelists both spellings in its CSP, which is why the
 * mismatch stayed invisible for so long.
 *
 * Import these instead of hardcoding the host, so the port and the IPv4
 * decision live in exactly one place.
 */

export const SIDECAR_PORT = 4545;
export const SIDECAR_HOST = `127.0.0.1:${SIDECAR_PORT}`;

/** Base for HTTP calls, no trailing slash: `http://127.0.0.1:4545` */
export const SIDECAR_HTTP = `http://${SIDECAR_HOST}`;

/** Base for WebSocket connections: `ws://127.0.0.1:4545` */
export const SIDECAR_WS = `ws://${SIDECAR_HOST}`;

/**
 * Build a sidecar URL from a path.
 * Accepts the path with or without a leading slash.
 *
 *   sidecarUrl('/search?q=foo')  // http://127.0.0.1:4545/search?q=foo
 *   sidecarUrl('health')         // http://127.0.0.1:4545/health
 */
export function sidecarUrl(path = '') {
  if (!path) return SIDECAR_HTTP;
  return `${SIDECAR_HTTP}${path.startsWith('/') ? '' : '/'}${path}`;
}
