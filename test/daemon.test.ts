// Daemon lifecycle: bind-or-attach, /health identity, the advisory record
// (corrupt ≠ absent), EPERM-is-not-death, and log rotation.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadDaemonRecord,
  logPath,
  portForRoot,
  processAlive,
  rotateLogs,
  runsInFlight,
  serviceDir,
  startDaemon,
} from "../src/service/daemon.ts";
import { StoreCorruptError } from "../src/store/json-file.ts";
import type { Store } from "../src/store/store.ts";

// Machine state now lives outside the repo (QK-SRV-006), so point it at a temp
// dir — otherwise every test run litters the developer's real ~/.local/state.
process.env.QUIRKS_STATE_DIR = mkdtempSync(join(tmpdir(), "quirks-state-"));

function storeFor(): Store {
  const root = mkdtempSync(join(tmpdir(), "quirks-daemon-"));
  return { root, dir: join(root, ".quirks") };
}

describe("code identity on /health (QK-SRV-006)", () => {
  test("reports the code this process compiled at startup", async () => {
    const store = storeFor();
    const daemon = startDaemon(store, 0);
    try {
      const body = await (await fetch(`http://127.0.0.1:${daemon.port}/health`)).json();
      expect(body.code.source).toBe("src");
      expect(body.code.fingerprint).not.toBe("unknown");
      expect(typeof body.startedAt).toBe("string");
      expect(Array.isArray(body.runsInFlight)).toBe(true);
    } finally {
      daemon.stop();
    }
  });

  test("the record is written outside the repo, never into .quirks/", async () => {
    const store = storeFor();
    const daemon = startDaemon(store, 0);
    try {
      expect(loadDaemonRecord(store)!.code?.source).toBe("src");
      expect(existsSync(join(store.dir, "service", "daemon.json"))).toBe(false);
      expect(serviceDir(store).startsWith(`${store.dir}/`)).toBe(false);
    } finally {
      daemon.stop();
    }
  });

  test("runsInFlight reports a running run, so restart can refuse", () => {
    const store = storeFor();
    mkdirSync(store.dir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(store.dir, "runs.json"),
      JSON.stringify({
        version: 1,
        runs: [
          { id: "run-009", name: "n", slug: "n", mode: "autonomous", status: "running",
            taskIds: [], plan: [], revision: 1, createdAt: now, updatedAt: now },
        ],
      }),
    );
    expect(runsInFlight(store)).toEqual(["run-009"]);
  });

  test("an unreadable runs record does not claim the coast is clear", () => {
    const store = storeFor();
    mkdirSync(store.dir, { recursive: true });
    writeFileSync(join(store.dir, "runs.json"), "{ torn");
    // Absence of proof is not proof of absence — refusing is the safe answer.
    expect(runsInFlight(store)).toHaveLength(1);
  });
});

describe("bind-or-attach", () => {
  test("bind serves /health with instance id, version, and the served root", async () => {
    const store = storeFor();
    const daemon = startDaemon(store, 0); // ephemeral port for the test
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.port}/health`);
      const health = await res.json();
      expect(health.id).toBe(daemon.instanceId);
      expect(health.root).toBe(store.root);
      expect(typeof health.version).toBe("string");
    } finally {
      daemon.stop();
    }
  });

  test("a second bind on the same port raises EADDRINUSE — the socket is the mutex", () => {
    const store = storeFor();
    const daemon = startDaemon(store, 0);
    try {
      expect(() => startDaemon(storeFor(), daemon.port)).toThrow();
    } finally {
      daemon.stop();
    }
  });

  test("the advisory record is written on bind and loads back", () => {
    const store = storeFor();
    const daemon = startDaemon(store, 0);
    try {
      const record = loadDaemonRecord(store);
      expect(record?.instanceId).toBe(daemon.instanceId);
      expect(record?.root).toBe(store.root);
      expect(record?.pid).toBe(process.pid);
    } finally {
      daemon.stop();
    }
  });
});

describe("the advisory record — corrupt is distinguished from absent", () => {
  test("absent is null", () => {
    expect(loadDaemonRecord(storeFor())).toBeNull();
  });

  test("corrupt JSON throws, never reads as absent", () => {
    const store = storeFor();
    mkdirSync(serviceDir(store), { recursive: true });
    writeFileSync(join(serviceDir(store), "daemon.json"), "{ torn");
    expect(() => loadDaemonRecord(store)).toThrow(StoreCorruptError);
  });

  test("valid JSON of the wrong shape is corrupt too", () => {
    const store = storeFor();
    mkdirSync(serviceDir(store), { recursive: true });
    writeFileSync(join(serviceDir(store), "daemon.json"), JSON.stringify({ hello: 1 }));
    expect(() => loadDaemonRecord(store)).toThrow(StoreCorruptError);
  });
});

describe("processAlive — a permission failure is not evidence of death", () => {
  test("EPERM means alive (exists, not ours)", () => {
    expect(processAlive(1, () => { throw Object.assign(new Error("eperm"), { code: "EPERM" }); })).toBe(true);
  });

  test("ESRCH means dead", () => {
    expect(processAlive(1, () => { throw Object.assign(new Error("esrch"), { code: "ESRCH" }); })).toBe(false);
  });

  test("a live signal-0 means alive", () => {
    expect(processAlive(process.pid)).toBe(true);
  });
});

describe("log rotation", () => {
  test("an oversized log rotates aside at startup; a small one stays", () => {
    const store = storeFor();
    mkdirSync(serviceDir(store), { recursive: true });
    writeFileSync(logPath(store), "x".repeat(64));
    rotateLogs(store, 1024);
    expect(existsSync(logPath(store))).toBe(true);
    expect(existsSync(`${logPath(store)}.1`)).toBe(false);

    writeFileSync(logPath(store), "x".repeat(2048));
    rotateLogs(store, 1024);
    expect(existsSync(`${logPath(store)}.1`)).toBe(true);
    expect(readFileSync(`${logPath(store)}.1`, "utf8").length).toBe(2048);
  });
});

describe("port derivation", () => {
  test("stable per root, distinct across roots, in the dynamic range", () => {
    const a = portForRoot("/repo/a");
    expect(portForRoot("/repo/a")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(45000);
    expect(a).toBeLessThan(60000);
    expect(portForRoot("/repo/b")).not.toBe(a);
  });
});
