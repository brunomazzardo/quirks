import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCursorArgv,
  buildCursorResumeArgv,
} from "../../src/runner/cursor.js";

const baseInput = {
  executable: "/usr/bin/agent",
  sessionId: "thread-1",
  model: "composer-2.5",
  briefPath: "artifacts/job-1/brief.md",
  workspace: "/tmp/worktree",
  artifactDir: "artifacts/job-1",
};

test("cursor argv uses non-interactive entry point with model and brief path", () => {
  const argv = buildCursorArgv(baseInput);
  assert.equal(argv[0], "/usr/bin/agent");
  assert.equal(argv.includes("-p"), true);
  assert.equal(argv.includes("--model"), true);
  assert.equal(argv[argv.indexOf("--model") + 1], "composer-2.5");
  assert.equal(argv.some((entry) => entry.includes(baseInput.briefPath)), true);
});

// Real-CLI probe 2026-07-24: buildCursorArgv passed `--file <briefPath>`, but
// cursor-agent 2026.07.20 has no such option. Every cursor dispatch exited 1
// in about a second with `error: unknown option '--file'`, before any model
// was contacted. This — not the account, model, or quota — is what failed the
// cursor reviewer. See docs/smoke/2026-07-24-runner-boundary-probe.md.
test("cursor argv never passes --file, which cursor-agent does not accept", () => {
  assert.equal(buildCursorArgv(baseInput).includes("--file"), false);
  assert.equal(buildCursorResumeArgv("thread-9", baseInput).includes("--file"), false);
});

// cursor-agent takes its prompt as a positional (`agent [prompt...]`), so the
// brief path must arrive as an instruction the model can act on, not as a bare
// path that reads as an ambiguous prompt.
test("cursor argv passes the brief as a trailing positional instruction, not a flag value", () => {
  const argv = buildCursorArgv(baseInput);
  const positional = argv.at(-1) ?? "";
  assert.equal(positional.startsWith("-"), false);
  assert.match(positional, /artifacts\/job-1\/brief\.md/);
  assert.notEqual(positional, baseInput.briefPath, "positional must instruct, not be a bare path");
  assert.match(positional, /complete it/i, "positional must instruct the job, not just name a file");
});

// The brief lives in artifactDir, outside the workspace, so without --add-dir a
// reviewer cannot even read it.
test("cursor argv never embeds brief prose, only a short instruction naming the file path", () => {
  const argv = buildCursorArgv(baseInput);
  for (const entry of argv) {
    assert.equal(entry.includes("\n"), false, `argv entry must stay single-line: ${entry}`);
  }
});

// --trust suppresses the workspace trust prompt, which would block a headless
// run regardless of write capability. It is not a write posture: --force is.
// Verified 2026-07-24 that a read-only cursor job with --trust and no --force
// writes its envelope, exits 0, and leaves the workspace clean.
test("cursor argv always passes --trust so a headless run cannot block on the trust prompt", () => {
  for (const capabilities of [["repository-read"], ["repository-read", "repository-write"]]) {
    const argv = buildCursorArgv({ ...baseInput, capabilities });
    assert.equal(argv.includes("--trust"), true, `--trust required for ${capabilities.join(",")}`);
  }
  assert.equal(buildCursorArgv(baseInput).includes("--trust"), true, "--trust required by default");
});

test("cursor argv omits the force write posture when capability is not granted", () => {
  const argv = buildCursorArgv({ ...baseInput, capabilities: ["repository-read"] });
  assert.equal(argv.includes("--force"), false);
});

test("cursor argv adds force posture only when profile capabilities allow it", () => {
  const argv = buildCursorArgv({ ...baseInput, capabilities: ["repository-read", "repository-write"] });
  assert.equal(argv.includes("--force"), true);
});

test("cursor argv defaults to no force posture when capabilities are absent", () => {
  const argv = buildCursorArgv(baseInput);
  assert.equal(argv.includes("--force"), false);
});

test("buildCursorResumeArgv includes --resume with the thread id", () => {
  const argv = buildCursorResumeArgv("thread-9", baseInput);
  assert.equal(argv[0], "/usr/bin/agent");
  assert.equal(argv.includes("--resume"), true);
  assert.equal(argv[argv.indexOf("--resume") + 1], "thread-9");
  assert.equal(argv.includes("-p"), true);
});
