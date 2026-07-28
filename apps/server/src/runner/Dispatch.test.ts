// Dispatch honesty: non-zero ≠ success; transcripts retained on timeout and flood.
// Ported from the bun-era test/runner-dispatch.test.ts (QK-MONO-005).
//
// Nothing here is a real agent CLI. Every "runner" is a throwaway shell script
// in a temp dir, which is what lets the timeout and process-group properties be
// exercised at all — a real CLI could not be asked to hang on cue.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { dispatchRunner, retainableTranscript, writeTranscript } from "./Dispatch.ts";
import { statusFromExit } from "./Types.ts";
import { runPlatform } from "../testing/Harness.ts";

function fakeBin(body: string): { bin: string; art: string; cwd: string } {
  const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
  const bin = join(dir, "fake-runner");
  writeFileSync(bin, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(bin, 0o755);
  return { bin, art: join(dir, "art"), cwd: dir };
}

describe("statusFromExit", () => {
  it("only exit 0 is success; timeout wins over exit code", () => {
    expect(statusFromExit(0, false)).toBe("success");
    expect(statusFromExit(1, false)).toBe("failure");
    expect(statusFromExit(0, true)).toBe("timeout");
    expect(statusFromExit(null, true)).toBe("timeout");
  });
});

describe("transcript retention", () => {
  it("writeTranscript never clobbers an earlier attempt", () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-tr-"));
    const first = writeTranscript(dir, "job-1", "attempt one");
    const second = writeTranscript(dir, "job-1", "attempt two");
    expect(first).not.toBe(second);
    expect(readFileSync(first ?? "", "utf8")).toBe("attempt one");
    expect(readFileSync(second ?? "", "utf8")).toBe("attempt two");
  });

  it("retainableTranscript keeps the tail when oversized", () => {
    const big = "a".repeat(2 * 1024 * 1024);
    const kept = retainableTranscript(big);
    expect(kept.startsWith("[transcript truncated")).toBe(true);
    expect(kept.endsWith("a".repeat(100))).toBe(true);
    expect(kept.length).toBeLessThan(big.length);
  });
});

describe("dispatchRunner", () => {
  it("exit 0 → success with retained transcript", async () => {
    const { bin, art, cwd } = fakeBin('echo "hello from runner"; exit 0');
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j1",
        runner: "claude",
        argv: [bin],
        artifactDir: art,
        timeoutMs: 5000,
        cwd,
      }),
    );
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath ?? "", "utf8")).toContain("hello from runner");
  });

  it("non-zero exit is never durable success — transcript still retained", async () => {
    const { bin, art, cwd } = fakeBin('echo "I refused"; exit 7');
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j2",
        runner: "codex",
        argv: [bin],
        artifactDir: art,
        timeoutMs: 5000,
        cwd,
      }),
    );
    expect(result.status).toBe("failure");
    expect(result.status).not.toBe("success");
    expect(result.exitCode).toBe(7);
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath ?? "", "utf8")).toContain("I refused");
    expect(result.failure?.code).toBe("non_zero_exit");
  });

  it("timeout retains whatever was said before the kill", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
    const art = join(dir, "art");
    // /bin/sh starts in about a millisecond, so the line is always emitted before
    // the 400ms bound — the test fails on the property, never on a startup race.
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j3",
        runner: "cursor",
        // No `exec`: sh FORKS `sleep`, so the grandchild inherits the stdout pipe.
        // That is the QK-RUN-007 case, and it is the realistic one — agent CLIs
        // spawn children constantly.
        argv: ["/bin/sh", "-c", 'echo "still working"; sleep 30'],
        artifactDir: art,
        timeoutMs: 400,
        cwd: dir,
      }),
    );
    expect(result.status).toBe("timeout");
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath ?? "", "utf8")).toContain("still working");
    expect(result.failure?.code).toBe("timeout");
  }, 10_000);

  it("a timeout is a real bound: a forked grandchild cannot extend it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
    const started = Date.now();
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j4",
        runner: "codex",
        // sh forks sleep, which inherits stdout. Killing only sh leaves that pipe
        // open, so waiting for stream 'close' waits for the sleep to finish.
        argv: ["/bin/sh", "-c", 'echo "begun"; sleep 30'],
        artifactDir: join(dir, "art"),
        timeoutMs: 300,
        cwd: dir,
      }),
    );
    const elapsed = Date.now() - started;

    expect(result.status).toBe("timeout");
    // Generous, but nothing like the 30s sleep — a timeout that can be exceeded
    // without bound is not a timeout.
    expect(elapsed).toBeLessThan(6000);
    // And the honesty property still holds on this path.
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath ?? "", "utf8")).toContain("begun");
  }, 20_000);

  it("the whole process group dies, leaving no orphan behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
    const marker = join(dir, "still-alive");
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j5",
        runner: "codex",
        // The grandchild would create the marker at 3s. If the group is killed at
        // 300ms it never gets there.
        argv: ["/bin/sh", "-c", `echo go; (sleep 3; touch ${marker}) & wait`],
        artifactDir: join(dir, "art"),
        timeoutMs: 300,
        cwd: dir,
      }),
    );
    expect(result.status).toBe("timeout");
    await new Promise((r) => setTimeout(r, 4000));
    expect(existsSync(marker)).toBe(false);
  }, 20_000);

  it("a binary that cannot be started is a failure that says so, not a success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j6",
        runner: "claude",
        argv: [join(dir, "no-such-runner")],
        artifactDir: join(dir, "art"),
        timeoutMs: 5000,
        cwd: dir,
      }),
    );
    expect(result.status).toBe("failure");
    expect(result.failure?.code).toBe("spawn_error");
    expect(result.exitCode).toBeNull();
  });

  it("empty argv is refused before anything is spawned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
    const result = await runPlatform(
      dispatchRunner({
        jobId: "j7",
        runner: "claude",
        argv: [],
        artifactDir: join(dir, "art"),
        timeoutMs: 5000,
        cwd: dir,
      }),
    );
    expect(result.status).toBe("failure");
    expect(result.failure?.code).toBe("invalid_argv");
  });
});
