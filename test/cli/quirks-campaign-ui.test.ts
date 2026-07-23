import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { CliParseError, parseUiOpenArgs, publicOpenPayload } from "../../src/cli/quirks-campaign.js";
import { createFakeWorkspacePorts, openWorkspace } from "../../src/ui/open-workspace.js";

test("parseUiOpenArgs accepts ui open --campaign", () => {
  assert.deepEqual(parseUiOpenArgs(["open", "--campaign", "C-1"]), { campaignId: "C-1", json: false, stay: false });
  assert.deepEqual(parseUiOpenArgs(["open", "--campaign", "C-1", "--json"]), { campaignId: "C-1", json: true, stay: false });
});

test("parseUiOpenArgs accepts ui open without --campaign as standalone", () => {
  assert.deepEqual(parseUiOpenArgs(["open"]), { json: false, stay: false });
  assert.deepEqual(parseUiOpenArgs(["open", "--json"]), { json: true, stay: false });
});

test("parseUiOpenArgs accepts --stay for scripted keep-alive", () => {
  assert.deepEqual(parseUiOpenArgs(["open", "--stay"]), { json: false, stay: true });
  assert.deepEqual(parseUiOpenArgs(["open", "--json", "--stay"]), { json: true, stay: true });
  assert.deepEqual(parseUiOpenArgs(["open", "--campaign", "C-1", "--stay"]), {
    campaignId: "C-1",
    json: false,
    stay: true,
  });
});

test("parseUiOpenArgs rejects missing values and unknown flags", () => {
  assert.throws(() => parseUiOpenArgs(["open", "--campaign"]), CliParseError);
  assert.throws(() => parseUiOpenArgs(["open", "--campaign", "C-1", "--unknown"]), CliParseError);
  assert.throws(() => parseUiOpenArgs(["open", "--stay", "--stay"]), CliParseError);
});

test("openWorkspace without a campaign opens a read-only workspace", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-standalone-"));
  const result = await openWorkspace({
    repositoryRoot: path.resolve("test/fixtures/json-project"),
    stateDir,
    keepAlive: false,
    deps: { json: true, isTty: false },
  });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.campaignId, undefined);
  assert.equal(result.approvalExpiresAt, undefined);
  assert.match(result.authority, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(result.launchUrl, /#viewToken=/);
  assert.doesNotMatch(result.launchUrl, /approvalToken=/);

  const payload = publicOpenPayload(result);
  assert.equal(payload.readOnly, true);
  assert.equal(payload.authority, result.authority);
  assert.ok(!("campaignId" in payload));
  assert.doesNotMatch(JSON.stringify(payload), /viewToken|approvalToken|qkview_|qkapprove_|#/);
});

test("openWorkspace json payload omits secrets and launch material", async () => {
  const opened: string[] = [];
  const result = await openWorkspace({
    campaignId: "C-1",
    ports: "fake",
    keepAlive: false,
    deps: { json: true, isTty: false, openBrowser: async (url: string) => { opened.push(url); } },
  });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify({
    ok: result.ok,
    authority: result.authority,
    repositoryId: result.repositoryId,
    campaignId: result.campaignId,
    viewerIdleExpiresAt: result.viewerIdleExpiresAt,
    viewerAbsoluteExpiresAt: result.viewerAbsoluteExpiresAt,
    ...(result.approvalExpiresAt ? { approvalExpiresAt: result.approvalExpiresAt } : {}),
  });
  assert.doesNotMatch(serialized, /viewToken|approvalToken|qkview_|qkapprove_|#/);
  assert.equal(opened.length, 0);
  assert.match(result.authority, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(result.approvalExpiresAt);
  assert.equal(result.readOnly, false);
});

test("openWorkspace issues approval token only for awaiting_approval campaigns", async () => {
  const awaiting = await openWorkspace({
    campaignId: "C-await",
    ports: createFakeWorkspacePorts({
      "C-await": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "awaiting_approval" },
    }),
    keepAlive: false,
    deps: { json: true, isTty: false },
  });
  assert.ok(awaiting.approvalExpiresAt);
  assert.match(awaiting.launchUrl, /approvalToken=/);

  const running = await openWorkspace({
    campaignId: "C-run",
    ports: createFakeWorkspacePorts({
      "C-run": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "running" },
    }),
    keepAlive: false,
    deps: { json: true, isTty: false },
  });
  assert.equal(running.approvalExpiresAt, undefined);
  assert.doesNotMatch(running.launchUrl, /approvalToken=/);
});

test("openWorkspace opens the browser only for tty non-json invocations", async () => {
  const opened: string[] = [];
  await openWorkspace({
    campaignId: "C-1",
    ports: "fake",
    keepAlive: false,
    deps: { json: false, isTty: true, openBrowser: async (url: string) => { opened.push(url); } },
  });
  assert.equal(opened.length, 1);
  assert.match(opened[0]!, /#viewToken=/);
});

test("openWorkspace reports authority without opening a browser on non-tty", async () => {
  const opened: string[] = [];
  const result = await openWorkspace({
    campaignId: "C-1",
    ports: "fake",
    keepAlive: false,
    deps: { json: false, isTty: false, openBrowser: async (url: string) => { opened.push(url); } },
  });
  assert.equal(opened.length, 0);
  assert.equal(result.requiresInteractiveRerun, true);
});

const execFileAsync = promisify(execFile);

async function freshStandaloneCliRepo(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-cli-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-ui-cli-state-"));
  await cp(path.resolve("test/fixtures/json-project"), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return { root, stateDir };
}

function readLine(stream: Readable, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => {
      stream.off("data", onData);
      reject(new Error(`No stdout line within ${timeoutMs}ms; received ${JSON.stringify(buffered)}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      stream.off("data", onData);
      resolve(buffered.slice(0, newline));
    };
    stream.on("data", onData);
  });
}

test("ui open --json --stay keeps serving until SIGTERM and exits cleanly", async () => {
  const { root, stateDir } = await freshStandaloneCliRepo();
  const child = spawn(
    process.execPath,
    [path.resolve("dist/src/cli/quirks-campaign.js"), "ui", "open", "--json", "--stay"],
    {
      cwd: root,
      env: { ...process.env, QUIRKS_STATE_DIR: stateDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  try {
    const line = await readLine(child.stdout!, 15_000);
    assert.doesNotMatch(line, /viewToken|approvalToken|qkview_|qkapprove_|#/);
    const payload = JSON.parse(line) as { ok: boolean; authority: string; readOnly: boolean };
    assert.equal(payload.ok, true);
    assert.equal(payload.readOnly, true);
    assert.match(payload.authority, /^http:\/\/127\.0\.0\.1:\d+$/);

    // Liveness: the server must still answer after the payload was printed.
    // The shell route serves 200 without authentication (projection data and
    // credentials never live in the shell), so anything else is a regression.
    const response = await fetch(`${payload.authority}/`, { signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    assert.equal(response.status, 200, `expected the unauthenticated shell, got ${response.status}`);

    const exit = once(child, "exit", { signal: AbortSignal.timeout(15_000) }) as Promise<
      [number | null, NodeJS.Signals | null]
    >;
    child.kill("SIGTERM");
    const [code, signal] = await exit;
    assert.equal(signal, null, `expected a handled SIGTERM shutdown, got signal ${signal}; stderr: ${stderr}`);
    assert.equal(code, 0, `expected exit code 0; stderr: ${stderr}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
