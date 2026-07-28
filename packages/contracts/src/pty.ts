// The pty wire contract (QK-WB-004) — sessions the service owns, rendered by
// xterm in the workbench.
//
// Transport: one WebSocket per session at GET /v1/pty/sessions/:id/socket.
// Binary frames carry raw terminal bytes (pty output outbound, stdin inbound);
// text frames carry the JSON control unions below. Every operation is ALSO
// reachable over plain HTTP, so the surface is drivable with curl and testable
// without a socket. Server-side bounds (replay buffer, backlog, session caps)
// are the server's own constants — see apps/server/src/pty/Wire.ts; this
// package stays type-only importable (D3a).

/** What the service reports about one session. `exitCode`/`signal` are null
 *  while it lives — absent is not the same as zero. */
export interface PtySessionInfo {
  readonly id: string;
  /** The program actually spawned (`$SHELL`, or the request's override). */
  readonly shell: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  /** The pty child's pid. It is also its process-group leader. */
  readonly pid: number;
  readonly startedAt: string;
  readonly exited: boolean;
  readonly exitedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: number | null;
  /** Bytes currently held in this session's replay buffer. */
  readonly replayBytes: number;
  /** Bytes this session produced that the replay buffer has already dropped —
   *  so a client can say "scrollback starts here" honestly rather than
   *  pretending it holds everything. */
  readonly droppedBytes: number;
}

/** POST /v1/pty/sessions. Every field is optional; the defaults are the point
 *  (the store root, `$SHELL`, 80x24). */
export interface PtyCreateRequest {
  readonly shell?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
  readonly cols?: number | undefined;
  readonly rows?: number | undefined;
  /** Extra environment on top of the daemon's own. */
  readonly env?: Readonly<Record<string, string>> | undefined;
}

/** GET /v1/pty/sessions */
export interface PtyListResponse {
  readonly sessions: readonly PtySessionInfo[];
}

/** POST /v1/pty/sessions/:id/write */
export interface PtyWriteRequest {
  readonly data: string;
}

/** POST /v1/pty/sessions/:id/resize */
export interface PtyResizeRequest {
  readonly cols: number;
  readonly rows: number;
}

/** Client → server. Terminal input rides binary frames, never these. */
export type PtyClientMessage =
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  /** Input as a string, for clients that would rather not send binary frames.
   *  The web client uses binary; this exists so the protocol is drivable by
   *  hand and by tests. */
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "ping" };

/** Server → client. Terminal output rides binary frames, never these. */
export type PtyServerMessage =
  /** Always first, and always before any replayed bytes: the client learns the
   *  session's dimensions and how much history it is about to be handed. */
  | { readonly type: "attached"; readonly session: PtySessionInfo; readonly replayBytes: number }
  /** The replayed bytes are done; everything after this frame is live. */
  | { readonly type: "live" }
  | {
      readonly type: "exit";
      readonly id: string;
      readonly exitCode: number;
      readonly signal: number;
    }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "pong" };
