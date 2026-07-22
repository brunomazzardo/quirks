import assert from "node:assert/strict";
import test from "node:test";
import {
  SMOKE_BRIEF_RELATIVE_PATH,
  SMOKE_EVIDENCE_RELATIVE_PATH,
  buildHostInvocation,
  classifyHostDiagnostics,
  redactDiagnostic,
} from "../../src/smoke/host-runner.js";

const brief = [
  "Run the Quirks campaign smoke flow for this repository.",
  `Repository-local brief file: ${SMOKE_BRIEF_RELATIVE_PATH}`,
  `Evidence output path (repository-relative): ${SMOKE_EVIDENCE_RELATIVE_PATH}`,
  "Write the evidence file last, then exit.",
].join("\n");
const fixtureRoot = "/tmp/quirks-smoke-fixture";

test("buildHostInvocation passes brief contents to claude via stdin", () => {
  const invocation = buildHostInvocation("claude", "/usr/bin/claude", brief, fixtureRoot);
  assert.equal(invocation.stdin, brief);
  assert.match(invocation.stdin!, /Repository-local brief file: \.quirks\/smoke\/host-brief\.md/);
  assert.deepEqual(invocation.argv, [
    "/usr/bin/claude",
    "-p",
    "--output-format",
    "json",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--add-dir",
    fixtureRoot,
  ]);
});

test("buildHostInvocation uses stdin for codex exec", () => {
  const invocation = buildHostInvocation("codex", "/usr/bin/codex", brief, fixtureRoot);
  assert.equal(invocation.stdin, brief);
  assert.match(invocation.stdin!, /Write the evidence file last, then exit/);
  assert.deepEqual(invocation.argv, ["/usr/bin/codex", "exec", "--json", "-C", fixtureRoot, "-"]);
});

test("buildHostInvocation passes prompt to cursor without --file", () => {
  const invocation = buildHostInvocation("cursor", "/usr/bin/cursor-agent", brief, fixtureRoot);
  assert.equal(invocation.stdin, undefined);
  assert.equal(invocation.argv.includes("--file"), false);
  assert.equal(invocation.argv.at(-1), brief);
  assert.deepEqual(invocation.argv.slice(0, 8), [
    "/usr/bin/cursor-agent",
    "-p",
    "--output-format",
    "json",
    "-f",
    "--trust",
    "--workspace",
    fixtureRoot,
  ]);
});

test("classifyHostDiagnostics returns codes without raw host output", () => {
  const home = process.env.HOME ?? "/Users/tester";
  const deviations = classifyHostDiagnostics({
    exitCode: 1,
    timedOut: false,
    stdout: '{"type":"thread.started"}',
    stderr: `failed in ${home}/secret`,
  });
  assert.equal(deviations[0], "host-exit:1");
  assert.equal(deviations.includes("host-stderr-error"), true);
  assert.equal(deviations.some((entry) => entry.startsWith("host-stderr:")), false);
  assert.equal(deviations.some((entry) => entry.startsWith("host-stdout:")), false);
});

test("classifyHostDiagnostics maps codex models cache failures", () => {
  const deviations = classifyHostDiagnostics({
    exitCode: 0,
    timedOut: false,
    stdout: "",
    stderr: "ERROR codex_models_manager::cache: missing field `supports_reasoning_summaries`",
  });
  assert.equal(deviations.includes("codex-models-cache-error"), true);
  assert.equal(deviations.some((entry) => entry.includes("supports_reasoning")), false);
});

test("redactDiagnostic removes bearer tokens", () => {
  const redacted = redactDiagnostic("Authorization Bearer abc.def.ghi failed");
  assert.match(redacted, /Bearer \[redacted\]/);
});
