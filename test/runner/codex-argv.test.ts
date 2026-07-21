import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexArgv,
  buildCodexResumeArgv,
  parseCodexResult,
} from "../../src/runner/codex.js";

test("buildCodexArgv uses codex exec with model, workspace, brief path, and result artifact", () => {
  const argv = buildCodexArgv({
    executable: "/usr/bin/codex",
    model: "gpt-5.6-terra-medium",
    workspace: "/tmp/worktree",
    briefPath: "artifacts/job-1/brief.md",
    resultPath: "artifacts/job-1/result.json",
  });

  assert.deepEqual(argv.slice(0, 2), ["/usr/bin/codex", "exec"]);
  assert.deepEqual(argv.slice(-1), ["artifacts/job-1/brief.md"]);
  assert.equal(argv.includes("done"), false);
  assert.equal(argv.includes("Read the brief"), false);
  assert.deepEqual(argv.slice(argv.indexOf("-m"), argv.indexOf("-m") + 2), ["-m", "gpt-5.6-terra-medium"]);
  assert.deepEqual(argv.slice(argv.indexOf("-C"), argv.indexOf("-C") + 2), ["-C", "/tmp/worktree"]);
  assert.deepEqual(argv.slice(argv.indexOf("-o"), argv.indexOf("-o") + 2), ["-o", "artifacts/job-1/result.json"]);
});

test("buildCodexResumeArgv uses codex exec resume with the session id", () => {
  const argv = buildCodexResumeArgv({
    executable: "/usr/bin/codex",
    sessionHandle: "codex-session-123",
    workspace: "/tmp/worktree",
  });

  assert.deepEqual(argv, ["/usr/bin/codex", "exec", "-C", "/tmp/worktree", "resume", "codex-session-123"]);
});

test("parseCodexResult requires declared artifact evidence and ignores transcript prose", () => {
  const result = parseCodexResult("done\nsession: prose-only\n", {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {},
  });

  assert.equal(result.status, "failure");
  assert.equal(result.sessionHandle, undefined);
  assert.deepEqual(result.artifactPaths, []);
  assert.match(result.failure ?? "", /Missing Codex result artifact/);
});

test("parseCodexResult reads status, session, and artifact paths from the declared artifact", () => {
  const result = parseCodexResult("transcript noise\n", {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {
      "artifacts/job-1/result.json": JSON.stringify({
        status: "success",
        sessionHandle: "codex-session-456",
        artifactPaths: ["artifacts/job-1/result.json", "artifacts/job-1/patch.diff"],
      }),
    },
  });

  assert.deepEqual(result, {
    status: "success",
    sessionHandle: "codex-session-456",
    artifactPaths: ["artifacts/job-1/result.json", "artifacts/job-1/patch.diff"],
    failure: undefined,
  });
});
