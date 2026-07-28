// Daemon lifecycle: bind-or-attach, /health identity, the advisory record
// (corrupt ≠ absent), EPERM-is-not-death, log rotation, and port derivation.
//
// Ported from the bun-era test/daemon.test.ts. The EPERM case travels with it by
// name: it is a carried defect (v1's QK-RUN-012 class), flagged forward by
// QK-MONO-005 precisely so it would not fall between two tasks.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { daemonRecordPath, serviceLogPath } from "@quirks/shared";
import { StoreCorruptError } from "../store/JsonFile.ts";
import {
  isAddressInUse,
  loadDaemonRecord,
  processAlive,
  recordFor,
  saveDaemonRecord,
  serviceDir,
  startDaemon,
  type StartedDaemon,
} from "./Daemon.ts";
import { baseFor, portForRoot, rotateLogs } from "./Machine.ts";

// Machine state lives outside the repo (QK-SRV-006), so point it at a temp dir —
// otherwise every test run would litter the developer's real ~/.local/state and,
// worse, could read the record of the daemon they are actually using.
beforeAll(() => {
  process.env.QUIRKS_STATE_DIR = mkdtempSync(join(tmpdir(), "quirks-state-"));
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "quirks-daemon-"));
}

const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, NodeServices.layer));

/** Hold a daemon open for the duration of `body`, and release the socket after.
 *  Port 0 asks the OS for an ephemeral port — no test may guess one. */
const withDaemon = <A>(root: string, body: (d: StartedDaemon) => Promise<A>): Promise<A> =>
  run(
    Effect.scoped(
      Effect.gen(function* () {
        const daemon = yield* startDaemon({ root, port: 0 });
        return yield* Effect.promise(() => body(daemon));
      }),
    ),
  );

describe("code identity on /health (QK-SRV-006)", () => {
  it("reports the code this process compiled at startup", async () => {
    await withDaemon(tempRoot(), async (daemon) => {
      const body = await (await fetch(`${baseFor(daemon.port)}/health`)).json();
      expect(body.code.source).toBe("src");
      expect(body.code.fingerprint).not.toBe("unknown");
      expect(typeof body.startedAt).toBe("string");
      expect(Array.isArray(body.runsInFlight)).toBe(true);
    });
  });

  it("the record is written outside the repo, never into .quirks/", async () => {
    const root = tempRoot();
    await withDaemon(root, async (daemon) => {
      await run(saveDaemonRecord(recordFor(daemon)));
      expect((await run(loadDaemonRecord(root)))?.code?.source).toBe("src");
      expect(existsSync(join(root, ".quirks", "service", "daemon.json"))).toBe(false);
      expect(serviceDir(root).startsWith(`${root}/.quirks/`)).toBe(false);
    });
  });

  it("the record and /health agree about the code being served", async () => {
    const root = tempRoot();
    await withDaemon(root, async (daemon) => {
      await run(saveDaemonRecord(recordFor(daemon)));
      const health = await (await fetch(`${baseFor(daemon.port)}/health`)).json();
      const record = await run(loadDaemonRecord(root));
      // Two answers to "what code is this?" that could disagree is the failure
      // this check exists to prevent — the daemon-status verdict reads one and
      // the operator reads the other.
      expect(record?.code?.fingerprint).toBe(health.code.fingerprint);
      expect(record?.startedAt).toBe(health.startedAt);
      expect(record?.port).toBe(daemon.port);
      expect(record?.pid).toBe(process.pid);
    });
  });
});

describe("bind-or-attach", () => {
  it("bind serves /health with instance id, version, and the served root", async () => {
    const root = tempRoot();
    await withDaemon(root, async (daemon) => {
      const health = await (await fetch(`${baseFor(daemon.port)}/health`)).json();
      expect(health.id).toBe(daemon.instanceId);
      expect(health.root).toBe(root);
      expect(typeof health.version).toBe("string");
    });
  });

  it("a second bind on the same port raises EADDRINUSE — the socket is the mutex", async () => {
    await withDaemon(tempRoot(), async (first) => {
      const error = await run(
        Effect.scoped(Effect.flip(startDaemon({ root: tempRoot(), port: first.port }))),
      );
      // Told apart from every other bind failure, because this one alone means
      // "attach" rather than "give up".
      expect(isAddressInUse(error)).toBe(true);
    });
  });

  it("POST /shutdown asks the daemon to stop, and the socket is the proof", async () => {
    const root = tempRoot();
    const port = await withDaemon(root, async (daemon) => {
      const body = await (
        await fetch(`${baseFor(daemon.port)}/shutdown`, { method: "POST" })
      ).json();
      expect(body).toEqual({ stopping: true, instanceId: daemon.instanceId, pid: process.pid });
      await Effect.runPromise(Effect.andThen(Effect.sleep("200 millis"), daemon.stopRequested));
      return daemon.port;
    });
    const after = await fetch(`${baseFor(port)}/health`).catch(() => null);
    expect(after).toBeNull();
  });
});

describe("the advisory record — corrupt is distinguished from absent", () => {
  it("absent is null", async () => {
    expect(await run(loadDaemonRecord(tempRoot()))).toBeNull();
  });

  it("corrupt JSON fails, never reads as absent", async () => {
    const root = tempRoot();
    mkdirSync(serviceDir(root), { recursive: true });
    writeFileSync(daemonRecordPath(root), "{ torn");
    expect(await run(Effect.flip(loadDaemonRecord(root)))).toBeInstanceOf(StoreCorruptError);
  });

  it("valid JSON of the wrong shape is corrupt too", async () => {
    const root = tempRoot();
    mkdirSync(serviceDir(root), { recursive: true });
    writeFileSync(daemonRecordPath(root), JSON.stringify({ hello: 1 }));
    const error = await run(Effect.flip(loadDaemonRecord(root)));
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain("not a daemon record");
  });
});

describe("processAlive — a permission failure is not evidence of death", () => {
  it("EPERM means alive (exists, not ours)", () => {
    expect(
      processAlive(1, () => {
        throw Object.assign(new Error("eperm"), { code: "EPERM" });
      }),
    ).toBe(true);
  });

  it("ESRCH means dead", () => {
    expect(
      processAlive(1, () => {
        throw Object.assign(new Error("esrch"), { code: "ESRCH" });
      }),
    ).toBe(false);
  });

  it("a live signal-0 means alive", () => {
    expect(processAlive(process.pid)).toBe(true);
  });
});

describe("log rotation", () => {
  it("an oversized log rotates aside; a small one stays", () => {
    const root = tempRoot();
    const log = serviceLogPath(root);
    mkdirSync(serviceDir(root), { recursive: true });

    writeFileSync(log, "x".repeat(64));
    rotateLogs(root, 1024);
    expect(existsSync(log)).toBe(true);
    expect(existsSync(`${log}.1`)).toBe(false);

    writeFileSync(log, "x".repeat(2048));
    rotateLogs(root, 1024);
    expect(existsSync(`${log}.1`)).toBe(true);
    expect(readFileSync(`${log}.1`, "utf8").length).toBe(2048);
  });

  it("an absent log is nothing to rotate, not a failure", () => {
    expect(() => rotateLogs(tempRoot(), 1)).not.toThrow();
  });

  it("drops the oldest rather than growing without bound", () => {
    const root = tempRoot();
    const log = serviceLogPath(root);
    mkdirSync(serviceDir(root), { recursive: true });
    for (const generation of ["oldest", "middle", "newest"]) {
      writeFileSync(log, generation.repeat(500));
      rotateLogs(root, 16);
    }
    expect(readFileSync(`${log}.1`, "utf8")).toContain("newest");
    expect(readFileSync(`${log}.2`, "utf8")).toContain("middle");
    expect(existsSync(`${log}.3`)).toBe(false);
  });
});

describe("port derivation", () => {
  it("stable per root, distinct across roots, in the dynamic range", () => {
    const a = portForRoot("/repo/a");
    expect(portForRoot("/repo/a")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(45000);
    expect(a).toBeLessThan(60000);
    expect(portForRoot("/repo/b")).not.toBe(a);
  });

  it("QUIRKS_PORT overrides, and a nonsense override is ignored rather than obeyed", () => {
    const original = process.env.QUIRKS_PORT;
    try {
      process.env.QUIRKS_PORT = "51999";
      expect(portForRoot("/repo/a")).toBe(51999);
      for (const nonsense of ["0", "80", "70000", "banana"]) {
        process.env.QUIRKS_PORT = nonsense;
        expect(portForRoot("/repo/a")).toBe(portForRoot("/repo/a"));
        expect(portForRoot("/repo/a")).toBeGreaterThanOrEqual(45000);
      }
    } finally {
      if (original === undefined) delete process.env.QUIRKS_PORT;
      else process.env.QUIRKS_PORT = original;
    }
  });
});
