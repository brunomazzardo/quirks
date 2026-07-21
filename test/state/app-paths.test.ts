import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveAppPaths } from "../../src/state/app-paths.js";

const repositoryId = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function withEnv(name: string, value: string | undefined, run: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test("isolates application state under QUIRKS_STATE_DIR", () => {
  withEnv("QUIRKS_STATE_DIR", "/tmp/quirks-test-state", () => {
    const paths = resolveAppPaths(repositoryId);
    assert.equal(paths.root, "/tmp/quirks-test-state");
    assert.equal(
      paths.repository,
      path.join("/tmp/quirks-test-state", "repositories", repositoryId.replace(":", "-")),
    );
    assert.equal(paths.campaigns, path.join(paths.repository, "campaigns"));
  });
});

test("uses the platform default state root when QUIRKS_STATE_DIR is unset", () => {
  withEnv("QUIRKS_STATE_DIR", undefined, () => {
    const paths = resolveAppPaths(repositoryId);
    const expectedRoot = process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Quirks")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Quirks")
        : path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "quirks");
    assert.equal(paths.root, expectedRoot);
  });
});

test("includes a campaign directory when campaignId is provided", () => {
  withEnv("QUIRKS_STATE_DIR", "/tmp/quirks-test-state", () => {
    const paths = resolveAppPaths(repositoryId, "C-42");
    assert.equal(paths.campaign, path.join(paths.campaigns, "C-42"));
  });
});
