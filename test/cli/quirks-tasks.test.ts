import assert from "node:assert/strict";
import test from "node:test";
import { CliParseError, parseArgs } from "../../src/cli/args.js";
import { exitCodeForError } from "../../src/cli/output.js";
import { QuirksError } from "../../src/core/errors.js";

test("parseArgs accepts the supported command shapes", () => {
  assert.deepEqual(parseArgs(["validate", "--json"]), { command: "validate", json: true });
  assert.deepEqual(parseArgs(["list", "--config", ".agents/quirks.json", "--status", "ready"]), {
    command: "list",
    configPath: ".agents/quirks.json",
    status: "ready",
    json: false,
  });
  assert.deepEqual(parseArgs(["show", "QK-1", "--json"]), { command: "show", taskId: "QK-1", json: true });
  assert.deepEqual(
    parseArgs([
      "propose",
      "QK-2",
      "--task-file",
      ".quirks/proposals/QK-2.json",
      "--idempotency-key",
      "brainstorm:QK-2:propose:v1",
      "--json",
    ]),
    {
      command: "propose",
      taskId: "QK-2",
      taskFile: ".quirks/proposals/QK-2.json",
      idempotencyKey: "brainstorm:QK-2:propose:v1",
      json: true,
    },
  );
  assert.deepEqual(parseArgs(["sync"]), { command: "sync", json: false });
});

test("mutation commands require a repository-relative request file", () => {
  assert.deepEqual(parseArgs(["propose", "--request-file", ".quirks/requests/propose.json", "--json"]), {
    command: "propose",
    requestFile: ".quirks/requests/propose.json",
    json: true,
  });
  for (const command of ["claim", "submit-review", "attach-provenance", "complete", "block", "release"]) {
    assert.deepEqual(parseArgs([command, "--request-file", ".quirks/requests/request.json"]), {
      command,
      requestFile: ".quirks/requests/request.json",
      json: false,
    });
  }
  assert.throws(() => parseArgs(["complete", "--request-file", "../outside.json"]), /repository-relative/);
});

test("parseArgs rejects duplicate flags, unknown options, and extra positionals", () => {
  assert.throws(() => parseArgs(["validate", "--json", "--json"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--config", "a", "--config", "b"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--unknown"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "-c"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--config"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "extra"]), CliParseError);
  assert.throws(() => parseArgs(["show", "QK-1", "extra"]), CliParseError);
  assert.throws(() => parseArgs(["propose", "QK-2", "--task-file", "task.json"]), CliParseError);
  assert.throws(() => parseArgs(["propose", "QK-2", "--idempotency-key", "key"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--status", "ready"]), CliParseError);
});

test("exitCodeForError maps domain and availability failures", () => {
  assert.equal(exitCodeForError(new QuirksError("SCHEMA_INVALID", "bad")), 3);
  assert.equal(exitCodeForError(new QuirksError("SOURCE_CONFLICT", "stale")), 3);
  assert.equal(exitCodeForError(new QuirksError("SOURCE_UNAVAILABLE", "down")), 4);
  assert.equal(exitCodeForError(new Error("boom")), 1);
});
