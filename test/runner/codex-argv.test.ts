import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { buildRunnerArgv } from "../../src/runner/cli-runner-port.js";
import {
  CODEX_CONTINUE_PROMPT,
  CODEX_PROMPT_MAX_BYTES,
  buildCodexArgv,
  buildCodexResumeArgv,
  codexPromptText,
  codexResultPath,
  codexResultSchemaPath,
  parseCodexResult,
  type BuildCodexArgvInput,
} from "../../src/runner/codex.js";
import type { RunnerProfile } from "../../src/runner/types.js";

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

test("buildCodexArgv terminates flag parsing before a prompt that starts with dashes", () => {
  const frontmatterBrief = "---\ntitle: brief\n---\nDo the thing.\n";
  const argv = buildCodexArgv({ ...freshInput, promptText: frontmatterBrief });

  assert.equal(argv.at(-1), frontmatterBrief);
  assert.equal(argv.at(-2), "--");
});

test("codexPromptText inlines brief contents under the size cap", () => {
  assert.equal(codexPromptText("/tmp/brief.md", "small brief"), "small brief");
});

test("codexResultPath is unique per job so concurrent jobs never clobber each other", () => {
  const first = codexResultPath("/tmp/artifacts", "job-1");
  const second = codexResultPath("/tmp/artifacts", "job-2");

  assert.notEqual(first, second);
  assert.match(first, /job-1/);
  assert.match(second, /job-2/);
});

function codexDispatchInput(jobId: string) {
  return {
    jobId,
    taskId: "QK-1",
    role: "implementer" as const,
    route: { profileId: "codex-standard", runnerType: "codex" as const, tier: "standard" as const, effort: "standard" as const, quotaPoolId: "pool" },
    briefPath: "/tmp/artifacts/briefs/brief.md",
    worktreePath: "/tmp/worktree",
  };
}

test("codex dispatch argv declares a job-unique result path per dispatched job", () => {
  const profile: RunnerProfile = {
    schemaVersion: 1,
    profileId: "codex-standard",
    runnerType: "codex",
    executable: "/usr/bin/codex",
    accountAlias: "default",
    quotaPoolId: "pool",
    tier: "standard",
    model: "test-model",
    effort: "standard",
    capabilities: ["repository-read"],
    wallClockMs: 5_000,
    redactionRules: [],
  };

  const first = flagValue(buildRunnerArgv(profile, codexDispatchInput("job-1"), "/tmp/artifacts/briefs", "# brief\n"), "-o");
  const second = flagValue(buildRunnerArgv(profile, codexDispatchInput("job-2"), "/tmp/artifacts/briefs", "# brief\n"), "-o");

  assert.notEqual(first, second);
  assert.match(first ?? "", /job-1/);
  assert.match(second ?? "", /job-2/);
});

test("codex dispatch argv references an existing result envelope schema", () => {
  const profile: RunnerProfile = {
    schemaVersion: 1,
    profileId: "codex-standard",
    runnerType: "codex",
    executable: "/usr/bin/codex",
    accountAlias: "default",
    quotaPoolId: "pool",
    tier: "standard",
    model: "test-model",
    effort: "standard",
    capabilities: ["repository-read"],
    wallClockMs: 5_000,
    redactionRules: [],
  };
  const argv = buildRunnerArgv(
    profile,
    {
      jobId: "job-1",
      taskId: "QK-1",
      role: "implementer",
      route: { profileId: "codex-standard", runnerType: "codex", tier: "standard", effort: "standard", quotaPoolId: "pool" },
      briefPath: "/tmp/artifacts/job-1/brief.md",
      worktreePath: "/tmp/worktree",
    },
    "/tmp/artifacts/job-1",
    "# brief\n",
  );

  const schemaPath = flagValue(argv, "--output-schema");
  assert.equal(schemaPath, codexResultSchemaPath());
  assert.equal(statSync(schemaPath ?? "").isFile(), true);

  const schema = JSON.parse(readFileSync(schemaPath ?? "", "utf8")) as {
    required?: string[];
    additionalProperties?: boolean;
    properties?: Record<string, { enum?: string[] }>;
  };
  assert.deepEqual(Object.keys(schema.properties ?? {}).toSorted(), [
    "artifactPaths",
    "failure",
    "sessionHandle",
    "status",
  ]);
  assert.deepEqual([...(schema.required ?? [])].toSorted(), [
    "artifactPaths",
    "failure",
    "sessionHandle",
    "status",
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...(schema.properties?.["status"]?.enum ?? [])].toSorted(), [
    "cancelled",
    "failure",
    "permission_denied",
    "success",
    "timeout",
    "usage_limit",
  ]);
});

test("codexPromptText points at the brief path for oversized or unreadable briefs", () => {
  const oversized = "x".repeat(CODEX_PROMPT_MAX_BYTES + 1);
  const pointer = codexPromptText("/tmp/brief.md", oversized);
  assert.notEqual(pointer, oversized);
  assert.match(pointer, /\/tmp\/brief\.md/);
  assert.match(codexPromptText("/tmp/brief.md", undefined), /\/tmp\/brief\.md/);
});

test("buildCodexResumeArgv keeps the result contract and continue prompt", () => {
  const argv = buildCodexResumeArgv({
    executable: "/usr/bin/codex",
    sessionHandle: "codex-session-123",
    briefPath: "artifacts/job-1/brief.md",
    resultPath: "artifacts/job-1/result.json",
    schemaPath: "schemas/codex-result.schema.json",
    capabilities: ["repository-read", "repository-write"],
    effort: "standard",
  });

  assert.deepEqual(argv.slice(0, 2), ["/usr/bin/codex", "exec"]);
  assert.equal(flagValue(argv, "-s"), "workspace-write");
  assert.equal(flagValue(argv, "-c"), "model_reasoning_effort=medium");
  assert.equal(flagValue(argv, "--output-schema"), "schemas/codex-result.schema.json");
  assert.equal(flagValue(argv, "--color"), "never");
  assert.equal(argv.includes("--json"), true);
  assert.equal(flagValue(argv, "-o"), "artifacts/job-1/result.json");

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
    sessionHandle: "codex-session-123",
    briefPath: "artifacts/job-1/brief.md",
    resultPath: "artifacts/job-1/result.json",
    schemaPath: "schemas/codex-result.schema.json",
    capabilities: ["repository-read"],
    effort: "mechanical",
    continuePrompt: "Wrap up now.",
  });

  assert.equal(flagValue(argv, "-s"), "read-only");
  assert.equal(flagValue(argv, "-c"), "model_reasoning_effort=low");
  assert.equal(argv.at(-1), "Wrap up now.");
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
    notes: [],
  });
});

const threadStartedEvent = JSON.stringify({ type: "thread.started", thread_id: "thread-789" });

test("parseCodexResult captures the session handle from --json events when the envelope omits it", () => {
  const result = parseCodexResult(`${threadStartedEvent}\n{"type":"turn.completed"}\n`, {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {
      "artifacts/job-1/result.json": JSON.stringify({
        status: "success",
        artifactPaths: ["artifacts/job-1/result.json"],
      }),
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.sessionHandle, "thread-789");
  assert.deepEqual(result.notes, []);
});

test("parseCodexResult prefers the JSONL session handle and notes envelope disagreement", () => {
  const result = parseCodexResult(`${threadStartedEvent}\n`, {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {
      "artifacts/job-1/result.json": JSON.stringify({
        status: "success",
        sessionHandle: "self-reported-session",
        artifactPaths: ["artifacts/job-1/result.json"],
      }),
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.sessionHandle, "thread-789");
  assert.deepEqual(result.notes, ["session_handle_mismatch"]);
});

test("parseCodexResult keeps the JSONL session handle when the result artifact is missing", () => {
  const result = parseCodexResult(`${threadStartedEvent}\n`, {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {},
  });

  assert.equal(result.status, "failure");
  assert.equal(result.sessionHandle, "thread-789");
  assert.match(result.failure ?? "", /Missing Codex result artifact/);
});

test("parseCodexResult classifies usage-limit stream errors when the envelope is absent", () => {
  const stdout = [
    threadStartedEvent,
    JSON.stringify({ type: "error", message: "You've hit your usage limit." }),
  ].join("\n");
  const result = parseCodexResult(`${stdout}\n`, {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {},
  });

  assert.equal(result.status, "usage_limit");
  assert.equal(result.sessionHandle, "thread-789");
  assert.match(result.failure ?? "", /usage limit/i);
});

test("parseCodexResult classifies interrupted turns when the envelope is absent", () => {
  const stdout = [
    threadStartedEvent,
    JSON.stringify({ type: "turn.failed", error: { message: "Turn interrupted" } }),
  ].join("\n");
  const result = parseCodexResult(`${stdout}\n`, {
    declaredResultPath: "artifacts/job-1/result.json",
    files: {},
  });

  assert.equal(result.status, "cancelled");
  assert.match(result.failure ?? "", /interrupted/i);
});
