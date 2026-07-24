import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { wrapCodexReviewerWithReviewArtifact } from "../../src/smoke/bounded-campaign.js";

const execFileAsync = promisify(execFile);

/**
 * The bounded reviewer shim is generated as a template string, so `tsc` and
 * oxlint cannot see inside it. A missing `readFile` import there produced a
 * ReferenceError that its own catch swallowed, silently discarding the real
 * reviewer's envelope and replacing it with verdict null — which the
 * explicit-accept guard then blocked, wedging every legitimate real campaign.
 * Nothing caught it because the regression test used the fake reviewer and
 * never executed the generated module. Executing it is the only honest check.
 * Raised by the independent codex review of e997039.
 */
async function generatedShim(): Promise<{ shimPath: string; configDir: string }> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-shim-"));
  // A stand-in "real codex" that writes an envelope the shim must preserve.
  const fakeCodex = path.join(configDir, "fake-real-codex.mjs");
  await writeFile(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      'import { writeFile } from "node:fs/promises";',
      "const argv = process.argv.slice(2);",
      'const out = argv[argv.indexOf("-o") + 1];',
      "const envelope = {",
      '  status: "success",',
      '  verdict: "accept",',
      '  sessionHandle: "real-codex-session",',
      "  artifactPaths: [out],",
      "  failure: null,",
      "};",
      "await writeFile(out, JSON.stringify(envelope));",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeCodex, 0o755);
  const shimPath = await wrapCodexReviewerWithReviewArtifact(configDir, fakeCodex);
  return { shimPath, configDir };
}

test("the generated reviewer shim preserves the reviewer's own accept verdict", async () => {
  const { shimPath, configDir } = await generatedShim();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "quirks-shim-ws-"));
  const resultPath = path.join(configDir, "codex-result.json");

  await execFileAsync(process.execPath, [shimPath, "-C", workspace, "-o", resultPath], {
    env: { ...process.env },
  });

  const envelope = JSON.parse(await readFile(resultPath, "utf8")) as {
    status: string;
    verdict: string | null;
    sessionHandle: string;
    artifactPaths: string[];
  };

  assert.equal(envelope.status, "success");
  assert.equal(envelope.verdict, "accept", "the reviewer's verdict must survive the shim");
  assert.equal(envelope.sessionHandle, "real-codex-session");
  assert.ok(
    envelope.artifactPaths.some((entry) => entry.endsWith(".md")),
    "the shim still adds its review artifact",
  );
});

test("the generated reviewer shim does not invent a verdict the reviewer never gave", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-shim-none-"));
  // A stand-in that writes NO envelope at all, so the shim has nothing to preserve.
  const silentCodex = path.join(configDir, "silent-codex.mjs");
  await writeFile(silentCodex, "#!/usr/bin/env node\n", "utf8");
  await chmod(silentCodex, 0o755);
  const shimPath = await wrapCodexReviewerWithReviewArtifact(configDir, silentCodex);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "quirks-shim-ws-"));
  const resultPath = path.join(configDir, "codex-result-none.json");

  await execFileAsync(process.execPath, [shimPath, "-C", workspace, "-o", resultPath]);

  const envelope = JSON.parse(await readFile(resultPath, "utf8")) as { verdict: string | null };
  assert.equal(
    envelope.verdict,
    null,
    "with no reviewer envelope the shim must not fabricate an approval",
  );
});
