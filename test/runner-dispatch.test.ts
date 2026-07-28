// Dispatch honesty: non-zero ≠ success; transcripts retained on timeout and flood.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchRunner, retainableTranscript, writeTranscript } from "../src/runner/dispatch.ts";
import { statusFromExit } from "../src/runner/types.ts";

function fakeBin(body: string): { bin: string; art: string; cwd: string } {
  const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
  const bin = join(dir, "fake-runner");
  writeFileSync(bin, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(bin, 0o755);
  return { bin, art: join(dir, "art"), cwd: dir };
}

describe("statusFromExit", () => {
  test("only exit 0 is success; timeout wins over exit code", () => {
    expect(statusFromExit(0, false)).toBe("success");
    expect(statusFromExit(1, false)).toBe("failure");
    expect(statusFromExit(0, true)).toBe("timeout");
    expect(statusFromExit(null, true)).toBe("timeout");
  });
});

describe("transcript retention", () => {
  test("writeTranscript never clobbers an earlier attempt", () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-tr-"));
    const first = writeTranscript(dir, "job-1", "attempt one");
    const second = writeTranscript(dir, "job-1", "attempt two");
    expect(first).not.toBe(second);
    expect(readFileSync(first!, "utf8")).toBe("attempt one");
    expect(readFileSync(second!, "utf8")).toBe("attempt two");
  });

  test("retainableTranscript keeps the tail when oversized", () => {
    const big = "a".repeat(2 * 1024 * 1024);
    const kept = retainableTranscript(big);
    expect(kept.startsWith("[transcript truncated")).toBe(true);
    expect(kept.endsWith("a".repeat(100))).toBe(true);
    expect(kept.length).toBeLessThan(big.length);
  });
});

describe("dispatchRunner", () => {
  test("exit 0 → success with retained transcript", async () => {
    const { bin, art, cwd } = fakeBin('echo "hello from runner"; exit 0');
    const result = await dispatchRunner({
      jobId: "j1",
      runner: "claude",
      argv: [bin],
      artifactDir: art,
      timeoutMs: 5000,
      cwd,
    });
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath!, "utf8")).toContain("hello from runner");
  });

  test("non-zero exit is never durable success — transcript still retained", async () => {
    const { bin, art, cwd } = fakeBin('echo "I refused"; exit 7');
    const result = await dispatchRunner({
      jobId: "j2",
      runner: "codex",
      argv: [bin],
      artifactDir: art,
      timeoutMs: 5000,
      cwd,
    });
    expect(result.status).toBe("failure");
    expect(result.status).not.toBe("success");
    expect(result.exitCode).toBe(7);
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath!, "utf8")).toContain("I refused");
    expect(result.failure?.code).toBe("non_zero_exit");
  });

  test("timeout retains whatever was said before the kill", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quirks-dispatch-"));
    const script = join(dir, "slow.ts");
    // Bun writes stdout without TTY line-buffering, so the line is visible before sleep.
    writeFileSync(script, `console.log("still working"); await Bun.sleep(30_000);\n`);
    const art = join(dir, "art");
    const result = await dispatchRunner({
      jobId: "j3",
      runner: "cursor",
      argv: [process.execPath, "run", script],
      artifactDir: art,
      timeoutMs: 400,
      cwd: dir,
    });
    expect(result.status).toBe("timeout");
    expect(result.transcriptPath).toBeTruthy();
    expect(readFileSync(result.transcriptPath!, "utf8")).toContain("still working");
    expect(result.failure?.code).toBe("timeout");
  }, 10000);
});
