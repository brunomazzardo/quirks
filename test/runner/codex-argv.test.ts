import assert from "node:assert/strict";
import test from "node:test";
import { buildRunnerArgv } from "../../src/runner/cli-runner-port.js";
import {
  CODEX_CONTINUE_PROMPT,
  CODEX_PROMPT_MAX_BYTES,
  buildCodexArgv,
  buildCodexResumeArgv,
  codexPromptText,
  type BuildCodexArgvInput,
} from "../../src/runner/codex.js";

const freshInput: BuildCodexArgvInput = {
  executable: "/usr/bin/codex",
  model: "gpt-5.6-terra-medium",
  workspace: "/tmp/worktree",
  promptText: "# brief\nDo the thing.\n",
  artifactDir: "artifacts/job-1",
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

test("buildCodexArgv maps profile effort tiers onto codex reasoning efforts", () => {
  const cases = [
    ["mechanical", "low"],
    ["standard", "medium"],
    ["high", "high"],
    ["principal", "high"],
    ["minimal", "minimal"],
  ] as const;

  for (const [effort, expected] of cases) {
    const argv = buildCodexArgv({ ...freshInput, effort });
    assert.equal(flagValue(argv, "-c"), `model_reasoning_effort=${expected}`);
  }
});

test("buildCodexArgv emits model, workspace, artifact dir, effort, color, and json, and nothing about result shape", () => {
  const argv = buildCodexArgv(freshInput);

  assert.deepEqual(argv.slice(0, 2), ["/usr/bin/codex", "exec"]);
  assert.equal(flagValue(argv, "-m"), "gpt-5.6-terra-medium");
  assert.equal(flagValue(argv, "-C"), "/tmp/worktree");
  assert.equal(flagValue(argv, "--add-dir"), "artifacts/job-1");
  assert.equal(flagValue(argv, "-c"), "model_reasoning_effort=high");
  // Measured 2026-07-24: under --output-schema codex emitted 0 prose messages
  // and smuggled a Critical finding into a 256-character transport field; the
  // same brief without it produced 8 substantive messages including two real
  // Criticals. The flag is dropped, not made optional (QK-RUN-009).
  assert.equal(argv.includes("--output-schema"), false);
  assert.equal(argv.includes("-o"), false);
  assert.equal(flagValue(argv, "--color"), "never");
  assert.equal(argv.includes("--json"), true);
});

test("buildCodexArgv passes the prompt text as the final positional, not the brief path", () => {
  const argv = buildCodexArgv(freshInput);

  assert.equal(argv.at(-1), "# brief\nDo the thing.\n");
  assert.equal(argv.includes("artifacts/job-1/brief.md"), false);
});

test("buildCodexArgv terminates flag parsing before a prompt that starts with dashes", () => {
  const frontmatterBrief = "---\ntitle: brief\n---\nDo the thing.\n";
  const argv = buildCodexArgv({ ...freshInput, promptText: frontmatterBrief });

  assert.equal(argv.at(-1), frontmatterBrief);
  assert.equal(argv.at(-2), "--");
});

test("codexPromptText inlines brief contents under the size cap", () => {
  assert.equal(codexPromptText("/tmp/brief.md", "small brief"), "small brief");
});

test("production codex argv constrains nothing about the shape of the final message", () => {
  const argv = buildRunnerArgv(
    {
      schemaVersion: 1,
      profileId: "codex-standard",
      runnerType: "codex",
      executable: "codex",
      accountAlias: "default",
      quotaPoolId: "pool",
      tier: "standard",
      model: "gpt-5.5",
      effort: "standard",
      capabilities: ["repository-read"],
      wallClockMs: 60_000,
      redactionRules: [],
    },
    {
      jobId: "job-1",
      taskId: "QK-1",
      role: "reviewer",
      route: { profileId: "codex-standard", runnerType: "codex", tier: "standard", effort: "standard", quotaPoolId: "pool" },
      briefPath: "/tmp/artifacts/job-1/brief.md",
      worktreePath: "/tmp/worktree",
    },
    "/tmp/artifacts/job-1",
    "# brief\n",
  );

  // A reviewer under --output-schema had nowhere to put its reasoning: its
  // final message *was* the envelope. It put a Critical finding into a
  // 256-character sessionHandle, truncated mid-sentence. Nothing in the argv
  // may constrain the final message again.
  assert.equal(argv.includes("--output-schema"), false);
  assert.equal(argv.includes("-o"), false);
  // The event stream stays: it is the transcript, not a result contract.
  assert.equal(argv.includes("--json"), true);
});

test("codexPromptText points at the brief path for oversized or unreadable briefs", () => {
  const oversized = "x".repeat(CODEX_PROMPT_MAX_BYTES + 1);
  const pointer = codexPromptText("/tmp/brief.md", oversized);
  assert.notEqual(pointer, oversized);
  assert.match(pointer, /\/tmp\/brief\.md/);
  assert.match(codexPromptText("/tmp/brief.md", undefined), /\/tmp\/brief\.md/);
});

test("buildCodexResumeArgv keeps the workspace binding and continue prompt, and constrains no output", () => {
  const argv = buildCodexResumeArgv({
    executable: "/usr/bin/codex",
    workspace: "/tmp/worktree",
    sessionHandle: "codex-session-123",
    briefPath: "artifacts/job-1/brief.md",
        capabilities: ["repository-read", "repository-write"],
    effort: "standard",
  });

  assert.deepEqual(argv.slice(0, 2), ["/usr/bin/codex", "exec"]);
  assert.equal(flagValue(argv, "-s"), "workspace-write");
  assert.equal(flagValue(argv, "-c"), "model_reasoning_effort=medium");
  // Measured 2026-07-24: under --output-schema codex emitted 0 prose messages
  // and smuggled a Critical finding into a 256-character transport field; the
  // same brief without it produced 8 substantive messages including two real
  // Criticals. The flag is dropped, not made optional (QK-RUN-009).
  assert.equal(argv.includes("--output-schema"), false);
  assert.equal(argv.includes("-o"), false);
  assert.equal(flagValue(argv, "--color"), "never");
  assert.equal(argv.includes("--json"), true);

  const resumeIndex = argv.indexOf("resume");
  assert.notEqual(resumeIndex, -1);
  assert.equal(argv.indexOf("-o") < resumeIndex, true);
  assert.equal(argv[resumeIndex + 1], "codex-session-123");
  assert.equal(argv[resumeIndex + 2], "--");
  assert.equal(argv[resumeIndex + 3], CODEX_CONTINUE_PROMPT.replace("<briefPath>", "artifacts/job-1/brief.md"));
  assert.equal(argv.length, resumeIndex + 4);
});

test("buildCodexResumeArgv maps read-only sandbox and honors an explicit continue prompt", () => {
  const argv = buildCodexResumeArgv({
    executable: "/usr/bin/codex",
    workspace: "/tmp/worktree",
    sessionHandle: "codex-session-123",
    briefPath: "artifacts/job-1/brief.md",
        capabilities: ["repository-read"],
    effort: "mechanical",
    continuePrompt: "Wrap up now.",
  });

  assert.equal(flagValue(argv, "-s"), "read-only");
  assert.equal(flagValue(argv, "-c"), "model_reasoning_effort=low");
  assert.equal(argv.at(-1), "Wrap up now.");
});
