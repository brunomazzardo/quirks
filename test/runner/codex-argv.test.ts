import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_PROMPT_MAX_BYTES,
  buildCodexArgv,
  buildCodexResumeArgv,
  codexPromptText,
  parseCodexResult,
  type BuildCodexArgvInput,
} from "../../src/runner/codex.js";

const freshInput: BuildCodexArgvInput = {
  executable: "/usr/bin/codex",
  model: "gpt-5.6-terra-medium",
  workspace: "/tmp/worktree",
  promptText: "# brief\nDo the thing.\n",
  resultPath: "artifacts/job-1/result.json",
  artifactDir: "artifacts/job-1",
  schemaPath: "schemas/codex-result.schema.json",
  capabilities: ["repository-read"],
  effort: "high",
};

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

test("buildCodexArgv maps repository-write capability to the workspace-write sandbox", () => {
  const argv = buildCodexArgv({
    ...freshInput,
    capabilities: ["repository-read", "repository-write"],
  });

  assert.equal(flagValue(argv, "-s"), "workspace-write");
});

test("buildCodexArgv defaults to the read-only sandbox without repository-write", () => {
  const argv = buildCodexArgv(freshInput);

  assert.equal(flagValue(argv, "-s"), "read-only");
});

test("buildCodexArgv emits model, workspace, artifact dir, effort, schema, color, json, and result flags", () => {
  const argv = buildCodexArgv(freshInput);

  assert.deepEqual(argv.slice(0, 2), ["/usr/bin/codex", "exec"]);
  assert.equal(flagValue(argv, "-m"), "gpt-5.6-terra-medium");
  assert.equal(flagValue(argv, "-C"), "/tmp/worktree");
  assert.equal(flagValue(argv, "--add-dir"), "artifacts/job-1");
  assert.equal(flagValue(argv, "-c"), "model_reasoning_effort=high");
  assert.equal(flagValue(argv, "--output-schema"), "schemas/codex-result.schema.json");
  assert.equal(flagValue(argv, "--color"), "never");
  assert.equal(argv.includes("--json"), true);
  assert.equal(flagValue(argv, "-o"), "artifacts/job-1/result.json");
});

test("buildCodexArgv passes the prompt text as the final positional, not the brief path", () => {
  const argv = buildCodexArgv(freshInput);

  assert.equal(argv.at(-1), "# brief\nDo the thing.\n");
  assert.equal(argv.includes("artifacts/job-1/brief.md"), false);
});

test("codexPromptText inlines brief contents under the size cap", () => {
  assert.equal(codexPromptText("/tmp/brief.md", "small brief"), "small brief");
});

test("codexPromptText points at the brief path for oversized or unreadable briefs", () => {
  const oversized = "x".repeat(CODEX_PROMPT_MAX_BYTES + 1);
  const pointer = codexPromptText("/tmp/brief.md", oversized);
  assert.notEqual(pointer, oversized);
  assert.match(pointer, /\/tmp\/brief\.md/);
  assert.match(codexPromptText("/tmp/brief.md", undefined), /\/tmp\/brief\.md/);
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
