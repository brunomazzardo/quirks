// End to end through the real entry: spawned, piped (so every answer is JSON),
// in a temp dir with no git repo — pins fall back to null and nothing prompts.
//
// Ported from the bun-era test/cli.test.ts. Since QK-SRV-004 every verb goes
// over HTTP: the first call in each dir autostarts a per-repo daemon, and
// `afterAll` stops each one through the socket it opened.
//
// Two rules this file keeps by construction, because breaking either would let
// a test reach the developer's real service:
//   - QUIRKS_STATE_DIR points at a temp dir, so no real daemon record is read,
//   - every repo gets an explicitly allocated free port, so the derived port
//     (and whatever is listening on it) is never dialled.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";

const BIN = fileURLToPath(new URL("../bin.ts", import.meta.url));
const CLI_DIR = fileURLToPath(new URL(".", import.meta.url));
const STATE = mkdtempSync(join(tmpdir(), "quirks-cli-state-"));

interface Repo {
  readonly cwd: string;
  readonly port: number;
}

const repos: Repo[] = [];

/** A port the OS just told us was free. Never a derived one: a derived port can
 *  collide with the daemon the developer is actually using, and a test suite
 *  that stops someone's daemon is worse than a test suite that fails. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });

async function tempRepo(prefix: string): Promise<Repo> {
  // realpath: the daemon's root comes from the CLI child's resolved cwd, and
  // macOS tempdirs are symlinked (/var → /private/var).
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const repo: Repo = { cwd, port: await freePort() };
  repos.push(repo);
  return repo;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function run(repo: Repo, ...args: string[]): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: repo.cwd,
      env: { ...process.env, QUIRKS_STATE_DIR: STATE, QUIRKS_PORT: String(repo.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

afterAll(async () => {
  for (const repo of repos) {
    await fetch(`http://127.0.0.1:${repo.port}/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
  }
});

describe("quirks CLI", () => {
  let cwd: Repo;

  it("goal new → task propose → claim → complete, all JSON when piped", async () => {
    cwd = await tempRepo("quirks-cli-");

    const goal = await run(
      cwd,
      "goal",
      "new",
      "QK-TST",
      "--title",
      "test goal",
      "--why",
      "prove step 1 works end to end",
      "--done-when",
      "the CLI suite passes",
    );
    expect(goal.code).toBe(0);
    expect(JSON.parse(goal.stdout).id).toBe("QK-TST");

    const t1 = await run(cwd, "task", "propose", "--goal", "QK-TST", "--title", "first");
    expect(JSON.parse(t1.stdout).id).toBe("QK-TST-001");

    const t2 = await run(
      cwd,
      "task",
      "propose",
      "--goal",
      "QK-TST",
      "--title",
      "second",
      "--depends-on",
      "QK-TST-001",
    );
    expect(JSON.parse(t2.stdout).dependsOn).toEqual(["QK-TST-001"]);

    // Dependency gate: claiming the dependent before its dependency completed fails.
    const blockedClaim = await run(cwd, "task", "claim", "QK-TST-002");
    expect(blockedClaim.code).toBe(1);
    expect(blockedClaim.stderr).toContain("QK-TST-001");

    expect((await run(cwd, "task", "claim", "QK-TST-001", "--by", "tester")).code).toBe(0);
    expect((await run(cwd, "task", "complete", "QK-TST-001", "--evidence", "done")).code).toBe(0);
    expect((await run(cwd, "task", "claim", "QK-TST-002")).code).toBe(0);

    const rows = JSON.parse((await run(cwd, "goal", "list")).stdout);
    expect(rows).toEqual([
      expect.objectContaining({ id: "QK-TST", total: 2, done: 1, open: 1, state: "in progress" }),
    ]);
  });

  it("the first verb autostarted a daemon, and it serves this repo", async () => {
    // The record proves the autostart wrote one; /health proves the socket is
    // the daemon's and that it is serving THIS root.
    const records = readdirSync(STATE).map((dir) => join(STATE, dir, "daemon.json"));
    expect(records.some((path) => existsSync(path))).toBe(true);

    const health = await (await fetch(`http://127.0.0.1:${cwd.port}/health`)).json();
    expect(health.root).toBe(cwd.cwd);

    const status = JSON.parse((await run(cwd, "daemon", "status")).stdout);
    expect(status.running).toBe(true);
    expect(status.port).toBe(cwd.port);
    // The CLI and the daemon it started are the same tree, so nothing drifted.
    expect(status.drifted).toBe(false);
    expect(status.comparable).toBe(true);
  });

  it("bare tasks mint numbers and imply no goal", async () => {
    const bare = await run(cwd, "task", "propose", "--title", "goal-less chore");
    expect(JSON.parse(bare.stdout).id).toBe("QK-001");
    const rows = JSON.parse((await run(cwd, "goal", "list")).stdout);
    expect(rows).toContainEqual(expect.objectContaining({ id: "(no goal)", recorded: false }));
  });

  it("leaving active without a reason is refused", async () => {
    const done = await run(cwd, "goal", "done", "QK-TST");
    expect(done.code).toBe(1);
    expect(done.stderr).toContain("--reason");
  });

  it("unknown revision check conflicts loudly", async () => {
    const out = await run(
      cwd,
      "task",
      "block",
      "QK-TST-002",
      "--reason",
      "test",
      "--if-revision",
      "99",
    );
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("revision");
  });

  it("--if-revision refuses a non-number rather than sending nonsense to the service", async () => {
    const out = await run(cwd, "task", "release", "QK-TST-002", "--if-revision", "soon");
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("--if-revision wants a number");
  });

  it("quirks run --yes starts headless; without --yes on a pipe it refuses", async () => {
    await run(
      cwd,
      "goal",
      "new",
      "QK-RN",
      "--title",
      "run goal",
      "--why",
      "prove run",
      "--done-when",
      "ok",
    );
    const a = JSON.parse(
      (await run(cwd, "task", "propose", "--goal", "QK-RN", "--title", "alpha")).stdout,
    );
    const b = JSON.parse(
      (
        await run(
          cwd,
          "task",
          "propose",
          "--goal",
          "QK-RN",
          "--title",
          "beta",
          "--depends-on",
          a.id,
        )
      ).stdout,
    );

    const refused = await run(cwd, "run", "--goal", "QK-RN", "--name", "pipe check");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("--yes");
    // It still prints the plan it refused to start — the operator sees what
    // they would have approved.
    expect(JSON.parse(refused.stdout).taskIds).toEqual([a.id, b.id]);

    const dry = await run(cwd, "run", "--goal", "QK-RN", "--name", "pipe check", "--dry-run");
    expect(dry.code).toBe(0);
    const dryBody = JSON.parse(dry.stdout);
    expect(dryBody.dryRun).toBe(true);
    expect(dryBody.briefs).toHaveLength(2);
    expect(dryBody.plan.taskIds).toEqual([a.id, b.id]);

    const started = await run(
      cwd,
      "run",
      "--goal",
      "QK-RN",
      "--name",
      "pipe check",
      "--yes",
      "--approve-only",
      "--mode",
      "autonomous",
    );
    expect(started.code).toBe(0);
    const body = JSON.parse(started.stdout);
    expect(body.status).toBe("approved");
    expect(body.slug).toBe("pipe-check");
    expect(body.taskIds).toEqual([a.id, b.id]);

    const listed = JSON.parse((await run(cwd, "run", "list")).stdout);
    expect(listed).toContainEqual(expect.objectContaining({ id: body.id, slug: "pipe-check" }));
    const shown = JSON.parse((await run(cwd, "run", "show", "pipe-check")).stdout);
    expect(shown.id).toBe(body.id);
  });

  it("quirks harness answers, and every row is honest about not having been probed", async () => {
    const view = JSON.parse((await run(cwd, "harness")).stdout);
    expect(view.probed).toBe(false);
    expect(view.harnesses.map((h: { runner: string }) => h.runner)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
    for (const row of view.harnesses) expect(row.version).toBeNull();
  });

  it("the verbs that do not exist yet say so instead of pretending", async () => {
    for (const verb of ["status", "report"]) {
      const out = await run(cwd, verb);
      expect(out.code).toBe(1);
      expect(out.stderr).toBe(`quirks: quirks ${verb} is not built yet\n`);
    }
  });

  it("daemon stop releases the socket, and the next verb starts a fresh one", async () => {
    const stopped = JSON.parse((await run(cwd, "daemon", "stop")).stdout);
    expect(stopped).toEqual({ stopped: true, wasRunning: true, port: cwd.port });
    expect(await fetch(`http://127.0.0.1:${cwd.port}/health`).catch(() => null)).toBeNull();

    // Stopping twice is not an error; there is simply nothing to stop.
    expect(JSON.parse((await run(cwd, "daemon", "stop")).stdout).wasRunning).toBe(false);

    const listed = await run(cwd, "task", "list");
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout).length).toBeGreaterThan(0);
  });

  it("a corrupt store is reported, never treated as empty", async () => {
    const corrupt = await tempRepo("quirks-corrupt-");
    await run(corrupt, "task", "propose", "--title", "seed"); // creates .quirks/
    writeFileSync(join(corrupt.cwd, ".quirks", "tasks.json"), "{ torn write");

    const out = await run(corrupt, "task", "list");
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("corrupt");
    // And a write refuses too, rather than clobbering the file it cannot read.
    expect((await run(corrupt, "task", "propose", "--title", "must not clobber")).code).toBe(1);
    expect(readFileSync(join(corrupt.cwd, ".quirks", "tasks.json"), "utf8")).toBe("{ torn write");
  });

  it("a foreign daemon on the derived port is refused loudly, never used", async () => {
    const foreign = await tempRepo("quirks-foreign-");
    const impostor = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "x", version: "0", root: "/somewhere/else" }));
      } else {
        res.writeHead(404).end("no");
      }
    });
    await new Promise<void>((resolve) => impostor.listen(foreign.port, "127.0.0.1", resolve));
    try {
      const out = await run(foreign, "task", "list");
      expect(out.code).toBe(1);
      expect(out.stderr).toContain("refusing to talk to another repo's daemon");
      expect(out.stderr).toContain("/somewhere/else");
      // Nothing was read from it — a wrong answer is worse than no answer.
      expect(out.stdout).toBe("");
    } finally {
      await new Promise((resolve) => impostor.close(resolve));
    }
  });

  it("an unreachable service names the log rather than guessing why", async () => {
    const dead = await tempRepo("quirks-dead-");
    // A socket that accepts and says nothing useful: /health never answers, so
    // autostart cannot bind either. The CLI must say where to look.
    const mute = createServer((_req, res) => res.writeHead(500).end());
    await new Promise<void>((resolve) => mute.listen(dead.port, "127.0.0.1", resolve));
    try {
      const out = await run(dead, "goal", "list");
      expect(out.code).toBe(1);
      expect(out.stderr).toContain(`unreachable at 127.0.0.1:${dead.port}`);
      expect(out.stderr).toContain("service.log");
    } finally {
      await new Promise((resolve) => mute.close(resolve));
    }
  }, 30_000);

  it("the CLI has no import path into the store — the boundary is structural", () => {
    // D4: the CLI's only path to data is HTTP. A store import would reintroduce
    // multi-writer concurrency exactly where it is hardest to observe, so the
    // rule is checked rather than remembered. `serve` is the one verb that runs
    // the service, and it reaches it through a dynamic import so no ordinary
    // verb loads it.
    for (const file of readdirSync(CLI_DIR).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(CLI_DIR, file), "utf8");
      expect({
        file,
        matched: /^import[^;]*from "\.\.\/(store|ops|run|runner|harness|App)/m.test(source),
      }).toEqual({ file, matched: false });
    }
  });
});
