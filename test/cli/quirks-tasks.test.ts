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
  assert.deepEqual(parseArgs(["sync"]), { command: "sync", json: false });
});

test("parseArgs rejects duplicate flags, unknown options, and extra positionals", () => {
  assert.throws(() => parseArgs(["validate", "--json", "--json"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--config", "a", "--config", "b"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--unknown"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "-c"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--config"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "extra"]), CliParseError);
  assert.throws(() => parseArgs(["show", "QK-1", "extra"]), CliParseError);
  assert.throws(() => parseArgs(["validate", "--status", "ready"]), CliParseError);
});

test("exitCodeForError maps domain and availability failures", () => {
  assert.equal(exitCodeForError(new QuirksError("SCHEMA_INVALID", "bad")), 3);
  assert.equal(exitCodeForError(new QuirksError("SOURCE_CONFLICT", "stale")), 3);
  assert.equal(exitCodeForError(new QuirksError("SOURCE_UNAVAILABLE", "down")), 4);
  assert.equal(exitCodeForError(new Error("boom")), 1);
});
