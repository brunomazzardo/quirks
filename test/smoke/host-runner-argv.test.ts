import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHostInvocation,
  diagnosticDeviations,
  redactDiagnostic,
} from "../../src/smoke/host-runner.js";

const brief = "Run the Quirks campaign smoke flow for this repository.";
const fixtureRoot = "/tmp/quirks-smoke-fixture";

test("buildHostInvocation passes brief contents to claude via stdin", () => {
  const invocation = buildHostInvocation("claude", "/usr/bin/claude", brief, fixtureRoot);
  assert.equal(invocation.stdin, brief);
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

test("diagnosticDeviations redacts home paths and captures exit code", () => {
  const home = process.env.HOME ?? "/Users/tester";
  const deviations = diagnosticDeviations({
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: `failed in ${home}/secret`,
  });
  assert.equal(deviations[0], "host-exit:1");
  assert.match(deviations[1]!, /host-stderr:failed in ~\/secret/);
});

test("redactDiagnostic removes bearer tokens", () => {
  const redacted = redactDiagnostic("Authorization Bearer abc.def.ghi failed");
  assert.match(redacted, /Bearer \[redacted\]/);
});
