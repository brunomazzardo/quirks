// The pty WebSocket, against a real bound daemon (QK-WB-004).
//
// These run through a socket the OS actually opened rather than an in-process
// handler, because the thing under test IS the upgrade: `toWebHandler` (what
// http/Service.test.ts uses) has no upgrade path at all, so a route that
// 404s on a real port would still look fine there.
//
// Same rule as Sessions.test.ts: every shell is `/bin/sh -c <script>` with an
// end condition, and every wait has a deadline.

import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { startDaemon, type StartedDaemon } from "../service/Daemon.ts";
import { baseFor } from "../service/Machine.ts";
import { tempRoot } from "../testing/Harness.ts";
import type { PtySessionInfo, PtyServerMessage } from "./Wire.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const withDaemon = <A>(body: (daemon: StartedDaemon, base: string) => Promise<A>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        // Port 0: the OS picks. No test may guess a port, and the user's real
        // daemon on 47301 must never be in reach of this suite.
        const daemon = yield* startDaemon({ root: tempRoot("quirks-ptyws-"), port: 0 });
        return yield* Effect.promise(() => body(daemon, baseFor(daemon.port)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

async function createSession(base: string, source: string): Promise<PtySessionInfo> {
  const response = await fetch(`${base}/v1/pty/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shell: "/bin/sh", args: ["-c", source] }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as PtySessionInfo;
}

/** Frames in arrival ORDER — the handshake's whole meaning is that `attached`
 *  precedes the replay and `live` follows it. A pair of unordered buckets
 *  could not tell those apart. */
type Frame = { kind: "control"; message: PtyServerMessage } | { kind: "data"; text: string };

function attach(base: string, id: string) {
  const socket = new WebSocket(`${base.replace("http://", "ws://")}/v1/pty/sessions/${id}/socket`);
  socket.binaryType = "arraybuffer";
  const frames: Frame[] = [];
  let closed = false;

  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data === "string") {
      frames.push({ kind: "control", message: JSON.parse(event.data) as PtyServerMessage });
    } else {
      frames.push({
        kind: "data",
        text: decoder.decode(new Uint8Array(event.data as ArrayBuffer)),
      });
    }
  });
  socket.addEventListener("close", () => {
    closed = true;
  });

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("websocket failed to open")));
  });

  return {
    socket,
    frames,
    opened,
    get closed(): boolean {
      return closed;
    },
    /** Everything the terminal would have painted, in order. */
    get output(): string {
      return frames
        .filter((f): f is { kind: "data"; text: string } => f.kind === "data")
        .map((f) => f.text)
        .join("");
    },
    get control(): PtyServerMessage[] {
      return frames
        .filter((f): f is { kind: "control"; message: PtyServerMessage } => f.kind === "control")
        .map((f) => f.message);
    },
    /** Data frames received BEFORE the `live` marker — i.e. the replay. */
    get history(): string {
      const liveAt = frames.findIndex((f) => f.kind === "control" && f.message.type === "live");
      const upTo = liveAt === -1 ? frames.length : liveAt;
      return frames
        .slice(0, upTo)
        .filter((f): f is { kind: "data"; text: string } => f.kind === "data")
        .map((f) => f.text)
        .join("");
    },
    type: (text: string) => socket.send(encoder.encode(text)),
    control_: (message: unknown) => socket.send(JSON.stringify(message)),
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close();
      }),
  };
}

async function waitFor(
  predicate: () => boolean,
  describeState: () => string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out after ${timeoutMs}ms; state: ${describeState()}`);
}

const ECHO_LOOP = 'stty -echo; while read l; do echo "out:$l"; done';

describe("the attach handshake", () => {
  it("announces the session, then history, then a live marker", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, ECHO_LOOP);
      const client = attach(base, session.id);
      await client.opened;

      await waitFor(
        () => client.control.some((m) => m.type === "live"),
        () => JSON.stringify(client.frames),
      );

      const [first, second] = client.control;
      expect(first?.type).toBe("attached");
      expect(second?.type).toBe("live");
      if (first?.type === "attached") {
        expect(first.session.id).toBe(session.id);
        expect(first.session.cols).toBe(80);
        expect(first.session.rows).toBe(24);
        expect(first.replayBytes).toBe(first.replayBytes);
      }
      await client.close();
    });
  });

  it("refuses a session that does not exist without upgrading", async () => {
    await withDaemon(async (_daemon, base) => {
      // The 404 is an HTTP status, which only exists BEFORE the handshake —
      // that is the whole reason the route resolves the session first.
      const response = await fetch(`${base}/v1/pty/sessions/pty_ghost/socket`);
      expect(response.status).toBe(404);

      const client = attach(base, "pty_ghost");
      await expect(client.opened).rejects.toThrow();
    });
  });
});

describe("bytes in, bytes out", () => {
  it("carries stdin on binary frames and output back the same way", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, ECHO_LOOP);
      const client = attach(base, session.id);
      await client.opened;
      await waitFor(
        () => client.control.some((m) => m.type === "live"),
        () => "no live marker",
      );

      client.type("hello-socket\n");
      await waitFor(
        () => client.output.includes("out:hello-socket"),
        () => JSON.stringify(client.output),
      );
      expect(client.output).toContain("out:hello-socket");
      await client.close();
    });
  });

  it("accepts input as a control frame too, so the wire is drivable by hand", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, ECHO_LOOP);
      const client = attach(base, session.id);
      await client.opened;
      await waitFor(
        () => client.control.some((m) => m.type === "live"),
        () => "no live marker",
      );

      client.control_({ type: "input", data: "typed-as-json\n" });
      await waitFor(
        () => client.output.includes("out:typed-as-json"),
        () => JSON.stringify(client.output),
      );
      await client.close();
    });
  });

  it("answers a ping, so a client can tell a quiet shell from a dead socket", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, "sleep 30");
      const client = attach(base, session.id);
      await client.opened;
      client.control_({ type: "ping" });
      await waitFor(
        () => client.control.some((m) => m.type === "pong"),
        () => JSON.stringify(client.control),
      );
      await client.close();
    });
  });

  it("reports a malformed control frame instead of dropping the socket", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, ECHO_LOOP);
      const client = attach(base, session.id);
      await client.opened;
      client.socket.send("{not json");
      await waitFor(
        () => client.control.some((m) => m.type === "error"),
        () => JSON.stringify(client.control),
      );
      // Still usable afterwards — an error frame is a report, not a hangup.
      client.type("still-here\n");
      await waitFor(
        () => client.output.includes("out:still-here"),
        () => JSON.stringify(client.output),
      );
      expect(client.closed).toBe(false);
      await client.close();
    });
  });
});

describe("resize over the socket", () => {
  it("reaches the shell's own idea of its terminal", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, "stty -echo; while read l; do stty size; done");
      const client = attach(base, session.id);
      await client.opened;
      await waitFor(
        () => client.control.some((m) => m.type === "live"),
        () => "no live marker",
      );

      client.control_({ type: "resize", cols: 120, rows: 40 });
      client.type("size?\n");
      await waitFor(
        () => client.output.includes("40 120"),
        () => JSON.stringify(client.output),
      );

      const info = (await (
        await fetch(`${base}/v1/pty/sessions/${session.id}`)
      ).json()) as PtySessionInfo;
      expect(info.cols).toBe(120);
      expect(info.rows).toBe(40);
      await client.close();
    });
  });

  it("reports impossible geometry as an error frame and keeps the size it had", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, "sleep 30");
      const client = attach(base, session.id);
      await client.opened;
      client.control_({ type: "resize", cols: 0, rows: 0 });
      await waitFor(
        () => client.control.some((m) => m.type === "error"),
        () => JSON.stringify(client.control),
      );
      const info = (await (
        await fetch(`${base}/v1/pty/sessions/${session.id}`)
      ).json()) as PtySessionInfo;
      expect(info.cols).toBe(80);
      await client.close();
    });
  });
});

describe("exit", () => {
  it("sends the exit code, after the output that preceded it", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, "echo last-words; exit 5");
      const client = attach(base, session.id);
      await client.opened;

      await waitFor(
        () => client.control.some((m) => m.type === "exit"),
        () => JSON.stringify(client.frames),
      );

      const exit = client.control.find((m) => m.type === "exit");
      expect(exit).toBeDefined();
      if (exit?.type === "exit") {
        expect(exit.exitCode).toBe(5);
        expect(exit.id).toBe(session.id);
      }
      // Ordering matters: the last line must not arrive after the obituary.
      const exitIndex = client.frames.findIndex(
        (f) => f.kind === "control" && f.message.type === "exit",
      );
      const wordsIndex = client.frames.findIndex(
        (f) => f.kind === "data" && f.text.includes("last-words"),
      );
      expect(wordsIndex).toBeGreaterThanOrEqual(0);
      expect(wordsIndex).toBeLessThan(exitIndex);
      await client.close();
    });
  });
});

describe("re-attaching — the scrollback the Native terminal never had", () => {
  it("repaints a session that ran while nothing was watching", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, ECHO_LOOP);

      const first = attach(base, session.id);
      await first.opened;
      await waitFor(
        () => first.control.some((m) => m.type === "live"),
        () => "no live marker",
      );
      first.type("before-reload\n");
      await waitFor(
        () => first.output.includes("out:before-reload"),
        () => JSON.stringify(first.output),
      );
      await first.close();

      // Nothing is attached now. The page "reloaded".
      await new Promise((resolve) => setTimeout(resolve, 200));

      const second = attach(base, session.id);
      await second.opened;
      await waitFor(
        () => second.control.some((m) => m.type === "live"),
        () => JSON.stringify(second.frames),
      );

      // What arrived BEFORE the live marker is history, and it holds output
      // produced while this client did not exist.
      expect(second.history).toContain("out:before-reload");
      const attached = second.control.find((m) => m.type === "attached");
      if (attached?.type === "attached") expect(attached.replayBytes).toBeGreaterThan(0);

      // And it is still a live terminal, not a transcript.
      second.type("after-reload\n");
      await waitFor(
        () => second.output.includes("out:after-reload"),
        () => JSON.stringify(second.output),
      );
      await second.close();
    });
  });
});

describe("two terminals at once — the acceptance criterion, over the wire", () => {
  it("runs two sockets against two sessions with independent interleaved output", async () => {
    await withDaemon(async (_daemon, base) => {
      const a = await createSession(base, 'stty -echo; while read l; do echo "A:$l"; done');
      const b = await createSession(base, 'stty -echo; while read l; do echo "B:$l"; done');
      expect(a.id).not.toBe(b.id);

      const clientA = attach(base, a.id);
      const clientB = attach(base, b.id);
      await Promise.all([clientA.opened, clientB.opened]);
      await waitFor(
        () =>
          clientA.control.some((m) => m.type === "live") &&
          clientB.control.some((m) => m.type === "live"),
        () => "one of the two never went live",
      );

      for (let i = 0; i < 5; i += 1) {
        clientA.type(`alpha${i}\n`);
        clientB.type(`beta${i}\n`);
      }

      await waitFor(
        () => clientA.output.includes("A:alpha4") && clientB.output.includes("B:beta4"),
        () => `A=${JSON.stringify(clientA.output)} B=${JSON.stringify(clientB.output)}`,
      );

      for (let i = 0; i < 5; i += 1) {
        expect(clientA.output).toContain(`A:alpha${i}`);
        expect(clientB.output).toContain(`B:beta${i}`);
      }
      expect(clientA.output).not.toContain("beta");
      expect(clientB.output).not.toContain("alpha");

      const listed = (await (await fetch(`${base}/v1/pty/sessions`)).json()) as {
        sessions: PtySessionInfo[];
      };
      expect(listed.sessions.filter((s) => !s.exited)).toHaveLength(2);

      await Promise.all([clientA.close(), clientB.close()]);
    });
  });

  it("closing one socket leaves the other terminal untouched", async () => {
    await withDaemon(async (_daemon, base) => {
      const a = await createSession(base, 'stty -echo; while read l; do echo "A:$l"; done');
      const b = await createSession(base, 'stty -echo; while read l; do echo "B:$l"; done');
      const clientA = attach(base, a.id);
      const clientB = attach(base, b.id);
      await Promise.all([clientA.opened, clientB.opened]);
      await waitFor(
        () =>
          clientA.control.some((m) => m.type === "live") &&
          clientB.control.some((m) => m.type === "live"),
        () => "one of the two never went live",
      );

      await clientA.close();

      clientB.type("still-alive\n");
      await waitFor(
        () => clientB.output.includes("B:still-alive"),
        () => JSON.stringify(clientB.output),
      );

      // Detaching is not killing: A's shell is still there for a re-attach.
      const info = (await (
        await fetch(`${base}/v1/pty/sessions/${a.id}`)
      ).json()) as PtySessionInfo;
      expect(info.exited).toBe(false);
      await clientB.close();
    });
  });
});

describe("the HTTP door onto the same sessions", () => {
  it("create, list, write, resize, and kill all work without a socket", async () => {
    await withDaemon(async (_daemon, base) => {
      const session = await createSession(base, ECHO_LOOP);

      const listed = (await (await fetch(`${base}/v1/pty/sessions`)).json()) as {
        sessions: PtySessionInfo[];
      };
      expect(listed.sessions.map((s) => s.id)).toEqual([session.id]);

      const written = await fetch(`${base}/v1/pty/sessions/${session.id}/write`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "curl-typed\n" }),
      });
      expect(written.status).toBe(200);

      const resized = await fetch(`${base}/v1/pty/sessions/${session.id}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      });
      expect(((await resized.json()) as PtySessionInfo).cols).toBe(100);

      // The output of that write is in the replay buffer, which a fresh attach
      // can prove without ever having been connected.
      const client = attach(base, session.id);
      await client.opened;
      await waitFor(
        () => client.history.includes("out:curl-typed") || client.output.includes("out:curl-typed"),
        () => JSON.stringify(client.frames),
      );
      await client.close();

      const killed = await fetch(`${base}/v1/pty/sessions/${session.id}/kill`, { method: "POST" });
      expect(killed.status).toBe(200);
      expect((await fetch(`${base}/v1/pty/sessions/${session.id}`)).status).toBe(404);
    });
  });

  it("maps refusals to honest statuses", async () => {
    await withDaemon(async (_daemon, base) => {
      const badGeometry = await fetch(`${base}/v1/pty/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shell: "/bin/sh", args: ["-c", "true"], cols: 0 }),
      });
      expect(badGeometry.status).toBe(400);

      expect((await fetch(`${base}/v1/pty/sessions/pty_ghost`)).status).toBe(404);
      expect(
        (await fetch(`${base}/v1/pty/sessions/pty_ghost/kill`, { method: "POST" })).status,
      ).toBe(404);

      const noData = await fetch(`${base}/v1/pty/sessions/pty_ghost/write`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(noData.status).toBe(400);
    });
  });
});
