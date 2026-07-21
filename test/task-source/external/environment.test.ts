import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createScrubbedEnvironment } from "../../../src/task-source/external/environment.js";

test("projects files under the sandbox root", async () => {
  const env = await createScrubbedEnvironment({
    explicitVariables: {},
    credentialVariables: {},
    projectedFiles: { "config/adapter.json": "{}" },
  });
  try {
    await access(path.join(env.sandboxRoot, "config", "adapter.json"));
  } finally {
    await env.cleanup();
  }
});

test("rejects absolute projected file paths", async () => {
  await assert.rejects(
    () =>
      createScrubbedEnvironment({
        explicitVariables: {},
        credentialVariables: {},
        projectedFiles: { "/etc/passwd": "evil" },
      }),
    /must be relative/,
  );
});

test("rejects projected file paths that escape via ..", async () => {
  await assert.rejects(
    () =>
      createScrubbedEnvironment({
        explicitVariables: {},
        credentialVariables: {},
        projectedFiles: { "../escape.txt": "evil" },
      }),
    /escapes sandbox/,
  );
});

test("rejects nested projected file paths that escape via ..", async () => {
  await assert.rejects(
    () =>
      createScrubbedEnvironment({
        explicitVariables: {},
        credentialVariables: {},
        projectedFiles: { "safe/../../escape.txt": "evil" },
      }),
    /escapes sandbox/,
  );
});
