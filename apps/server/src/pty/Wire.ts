// The pty wire contract (QK-WB-004).
//
// TRANSPORT — why a WebSocket, and what rides on it.
//
// A terminal is the one surface in this workbench where a round trip per
// keystroke is felt. SSE plus `POST …/write` would work and would have needed
// no new plumbing, but it costs a fresh HTTP request per keypress and gives the
// server no way to notice a client that has gone away mid-stream. Effect 4's
// `NodeHttpServer.layer` already registers a WebSocket upgrade handler on the
// very socket the daemon binds (`makeUpgradeHandler`, @effect/platform-node),
// so `HttpServerRequest.upgrade` yields a `Socket.Socket` with no dependency
// this repo did not already have and no second listener to manage. That is the
// transport: one WebSocket per session at
//
//   GET /v1/pty/sessions/:id/socket
//
// FRAMING. The socket carries two kinds of traffic and tells them apart by
// WebSocket frame type rather than by an envelope:
//
//   binary frames  raw terminal bytes — pty output outbound, stdin inbound.
//                  No base64, no JSON escaping: xterm's `write()` takes a
//                  Uint8Array and does its own (stateful) UTF-8 decoding, so
//                  bytes arrive exactly as the pty produced them.
//   text frames    JSON control messages, the two unions below.
//
// A per-session socket rather than one multiplexed socket is deliberate: it
// makes "close the tab" mean "close the socket", it lets a re-attaching client
// name the session in its URL, and it removes the stream-id demultiplexer that
// a shared socket would need in both directions.
//
// The same operations are ALSO reachable over plain HTTP (see Routes.ts), so
// every behavior below is testable without a socket and any non-browser client
// can drive a session with `curl`. The socket is the interactive door, not the
// only one.

// The wire types live in @quirks/contracts (they cross the wire; both the web
// client and this server import them type-only). The bounds below stay here:
// they are server policy, and the contracts package must remain type-only
// importable (D3a).
export type {
  PtyClientMessage,
  PtyCreateRequest,
  PtyListResponse,
  PtyResizeRequest,
  PtyServerMessage,
  PtySessionInfo,
  PtyWriteRequest,
} from "@quirks/contracts";

// ---- bounds, stated once so both sides can quote the same numbers ----

/**
 * Per-session server-side replay bound, in bytes.
 *
 * Scrollback proper is CLIENT side — xterm's own buffer, sized in lines (see
 * apps/web). This buffer answers a narrower question: a client that reloads the
 * page, or reconnects after the dev server restarted, must be able to repaint a
 * terminal that has been running without it. 256 KiB is roughly 3,000 lines of
 * 80-column output — comfortably more than any screen, and cheap enough to hold
 * for every one of MAX_SESSIONS at once (4 MiB worst case).
 *
 * The buffer is a byte ring that drops from the OLDEST end, so the invariant is
 * exact: a session never holds more than this many replay bytes. What was
 * dropped is counted, never hidden (`droppedBytes`).
 */
export const REPLAY_LIMIT_BYTES = 256 * 1024;

/**
 * Outbound bytes one attached socket may have queued while the client is not
 * reading, before the oldest are dropped. Four times the replay bound: a
 * terminal is a view, and a viewer that cannot keep up is better served stale
 * than stalled — but the pty must never block on it.
 */
export const SOCKET_BACKLOG_LIMIT_BYTES = 4 * REPLAY_LIMIT_BYTES;

/** A guard on runaway session creation, not a product limit. */
export const MAX_SESSIONS = 16;

/** Refuse absurd geometry rather than pass it to `ioctl`. */
export const MIN_COLS = 1;
export const MAX_COLS = 1000;
export const MIN_ROWS = 1;
export const MAX_ROWS = 1000;

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

/** One write, capped. Terminal input is keystrokes and pastes, not uploads. */
export const MAX_INPUT_BYTES = 1024 * 1024;
