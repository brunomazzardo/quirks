// The pty surface: five plain /v1 routes and one WebSocket (QK-WB-004).
//
// Both doors reach the same `PtySessions` service, which is deliberate. The
// socket is what a terminal actually uses — a keystroke should not cost an HTTP
// request — but every behavior it exposes is also reachable over ordinary HTTP,
// so the whole feature is testable without a socket and drivable with `curl`.
//
//   POST   /v1/pty/sessions              create        → PtySessionInfo (201)
//   GET    /v1/pty/sessions              list          → PtyListResponse
//   GET    /v1/pty/sessions/:id          one session   → PtySessionInfo
//   POST   /v1/pty/sessions/:id/write    stdin         → PtySessionInfo
//   POST   /v1/pty/sessions/:id/resize   geometry      → PtySessionInfo
//   POST   /v1/pty/sessions/:id/kill     stop          → PtySessionInfo
//   GET    /v1/pty/sessions/:id/socket   attach        → WebSocket
//
// The upgrade needs no server plumbing of its own: `NodeHttpServer.layer`
// already installs a `ws` upgrade handler beside its request handler, so
// `HttpServerRequest.upgrade` hands back an Effect `Socket` on the very port
// the daemon binds. One listener, one port, one shutdown.

import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { Socket } from "effect/unstable/socket";
import { json, jsonError, pathParam, respond } from "../http/Wire.ts";
import { PtySessions, type PtyListener, type PtySessionsShape } from "./Sessions.ts";
import { ByteRing } from "./Replay.ts";
import {
  SOCKET_BACKLOG_LIMIT_BYTES,
  type PtyClientMessage,
  type PtyCreateRequest,
  type PtyListResponse,
  type PtyServerMessage,
} from "./Wire.ts";

const body = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return (yield* request.json) as Record<string, unknown> | null;
});

const str = (source: Record<string, unknown> | null, key: string): string | undefined => {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
};

const num = (source: Record<string, unknown> | null, key: string): number | undefined => {
  const value = source?.[key];
  return typeof value === "number" ? value : undefined;
};

/** `args` is only honored as a real array — a caller that sends a string gets
 *  the default shell rather than a single argument nobody meant. */
const strList = (
  source: Record<string, unknown> | null,
  key: string,
): readonly string[] | undefined => {
  const value = source?.[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
};

const envRecord = (
  source: Record<string, unknown> | null,
  key: string,
): Readonly<Record<string, string>> | undefined => {
  const value = source?.[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item === "string") out[name] = item;
  }
  return out;
};

const createRequestFrom = (input: Record<string, unknown> | null): PtyCreateRequest => ({
  shell: str(input, "shell"),
  args: strList(input, "args"),
  cwd: str(input, "cwd"),
  cols: num(input, "cols"),
  rows: num(input, "rows"),
  env: envRecord(input, "env"),
});

// ---------------------------------------------------------------------------
// the socket
// ---------------------------------------------------------------------------

const decoder = new TextDecoder();

/**
 * Serve one attached client.
 *
 * The shape is a reader in the foreground and a writer on a forked fiber,
 * joined by a latch. That indirection exists because pty output arrives on a
 * plain node callback while the socket's writer is an Effect: the callback
 * appends to a byte ring and opens the latch — both synchronous, both
 * allocation-light — and the writer fiber does the actual sending.
 *
 * BACKPRESSURE. `backlog` is bounded (SOCKET_BACKLOG_LIMIT_BYTES). A client
 * that stops reading therefore costs a fixed amount of memory and loses its
 * OLDEST pending output, rather than growing without limit or stalling the
 * shell for every other viewer. A terminal is a view; a viewer that cannot keep
 * up is better served stale than blocking.
 */
const serveAttachment = (
  sessions: PtySessionsShape,
  id: string,
  socket: Socket.Socket,
): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const send = yield* socket.writer;
      const backlog = new ByteRing(SOCKET_BACKLOG_LIMIT_BYTES);
      const control: PtyServerMessage[] = [];
      const wake = yield* Latch.make();
      let finished = false;

      const push = (message: PtyServerMessage): void => {
        control.push(message);
        wake.openUnsafe();
      };

      const listener: PtyListener = {
        onData: (bytes) => {
          backlog.push(bytes);
          wake.openUnsafe();
        },
        onExit: (exit) => {
          push({ type: "exit", id, exitCode: exit.exitCode, signal: exit.signal });
        },
      };

      // Subscribe FIRST, so output produced during the handshake queues in
      // `backlog` rather than being lost. The replay snapshot is taken in the
      // same synchronous breath as the subscription (see Sessions.attach), so
      // the two cannot overlap or leave a gap.
      const attachment = yield* sessions.attach(id, listener);

      const flush = Effect.gen(function* () {
        const bytes = backlog.take();
        if (bytes.byteLength > 0) yield* send(bytes);
        while (control.length > 0) {
          const message = control.shift();
          if (message !== undefined) yield* send(JSON.stringify(message));
        }
      });

      /**
       * Nothing may be written before the socket is open.
       *
       * `Socket.writer` hands back a `write` that sits on an internal latch
       * which `runRaw` opens only once the WebSocket is live — so a send issued
       * before the read loop starts does not fail, it BLOCKS, and the route
       * deadlocks against a socket that is already connected. The handshake
       * therefore lives on the writer fiber behind `socketOpen`, which
       * `runRaw`'s `onOpen` hook opens at exactly the right moment.
       */
      const socketOpen = yield* Latch.make();

      const writerLoop = Effect.gen(function* () {
        yield* socketOpen.await;

        // Handshake, in this order: the client learns the geometry, then
        // receives everything it missed, then is told where history ends.
        yield* send(
          JSON.stringify({
            type: "attached",
            session: attachment.session,
            replayBytes: attachment.replay.byteLength,
          } satisfies PtyServerMessage),
        );
        if (attachment.replay.byteLength > 0) yield* send(attachment.replay);
        yield* send(JSON.stringify({ type: "live" } satisfies PtyServerMessage));

        // Close the latch BEFORE draining: anything that arrives while we
        // drain re-opens it and is picked up next turn, so no wakeup is lost.
        // The exit check is at the BOTTOM so the last wake still flushes —
        // a shell's final line must not be lost to its own exit frame.
        for (;;) {
          yield* wake.await;
          wake.closeUnsafe();
          yield* flush;
          if (finished) return;
        }
      });

      yield* Effect.forkScoped(writerLoop);

      const onControl = (text: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          let message: PtyClientMessage;
          try {
            message = JSON.parse(text) as PtyClientMessage;
          } catch {
            push({ type: "error", message: "control frame was not JSON" });
            return;
          }
          switch (message.type) {
            case "resize": {
              yield* sessions.resize(id, message.cols, message.rows);
              return;
            }
            case "input": {
              yield* sessions.write(id, message.data);
              return;
            }
            case "ping": {
              push({ type: "pong" });
              return;
            }
            default: {
              push({ type: "error", message: "unknown control frame" });
            }
          }
        }).pipe(
          // A bad resize or a write to a dead shell tells the client what went
          // wrong; it never takes the socket down.
          Effect.catch((error) =>
            Effect.sync(() => push({ type: "error", message: error.message })),
          ),
        );

      yield* socket
        .runRaw(
          (frame) =>
            typeof frame === "string"
              ? onControl(frame)
              : // Binary frames are stdin, verbatim.
                sessions
                  .write(id, decoder.decode(frame))
                  .pipe(
                    Effect.catch((error) =>
                      Effect.sync(() => push({ type: "error", message: error.message })),
                    ),
                  ),
          { onOpen: socketOpen.open },
        )
        // A socket that ends — the tab closed, the page reloaded — is the
        // normal case, not a fault. `defaultCloseCodeIsError` treats every
        // close code as an error, so this catch is what makes a clean goodbye
        // quiet.
        .pipe(Effect.catch(() => Effect.void));

      finished = true;
      wake.openUnsafe();
    }),
  ).pipe(
    // The scope is closing anyway; a write that lost a race with the client's
    // FIN is not something a route can act on.
    Effect.catchCause(() => Effect.void),
  );

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

export const routes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/v1/pty/sessions",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        return json(yield* sessions.create(createRequestFrom(yield* body)), 201);
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/pty/sessions",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        return json({ sessions: yield* sessions.list } satisfies PtyListResponse);
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/pty/sessions/:id",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        return json(yield* sessions.get(yield* pathParam("id")));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/pty/sessions/:id/write",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        const id = yield* pathParam("id");
        const data = str(yield* body, "data");
        if (data === undefined) return jsonError("data must be a string", 400);
        yield* sessions.write(id, data);
        return json(yield* sessions.get(id));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/pty/sessions/:id/resize",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        const id = yield* pathParam("id");
        const input = yield* body;
        const cols = num(input, "cols");
        const rows = num(input, "rows");
        if (cols === undefined || rows === undefined) {
          return jsonError("cols and rows must be numbers", 400);
        }
        return json(yield* sessions.resize(id, cols, rows));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/pty/sessions/:id/kill",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        return json(yield* sessions.kill(yield* pathParam("id")));
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/pty/sessions/:id/socket",
    respond(
      Effect.gen(function* () {
        const sessions = yield* PtySessions;
        const id = yield* pathParam("id");
        // Resolve the session BEFORE upgrading. Once the handshake has
        // happened there is no status code left to send, and "404" delivered
        // as a WebSocket frame is a worse answer than a 404.
        yield* sessions.get(id);
        const request = yield* HttpServerRequest.HttpServerRequest;
        const socket = yield* request.upgrade;
        yield* serveAttachment(sessions, id, socket);
        return HttpServerResponse.empty();
      }),
    ),
  ),
);
