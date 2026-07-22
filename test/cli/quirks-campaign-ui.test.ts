import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CliParseError, parseUiOpenArgs, publicOpenPayload } from "../../src/cli/quirks-campaign.js";
import { createFakeWorkspacePorts, openWorkspace } from "../../src/ui/open-workspace.js";

test("parseUiOpenArgs accepts ui open --campaign", () => {
  assert.deepEqual(parseUiOpenArgs(["open", "--campaign", "C-1"]), { campaignId: "C-1", json: false });
  assert.deepEqual(parseUiOpenArgs(["open", "--campaign", "C-1", "--json"]), { campaignId: "C-1", json: true });
});

test("parseUiOpenArgs accepts ui open without --campaign as standalone", () => {
  assert.deepEqual(parseUiOpenArgs(["open"]), { json: false });
  assert.deepEqual(parseUiOpenArgs(["open", "--json"]), { json: true });
});

test("parseUiOpenArgs rejects missing values and unknown flags", () => {
  assert.throws(() => parseUiOpenArgs(["open", "--campaign"]), CliParseError);
  assert.throws(() => parseUiOpenArgs(["open", "--campaign", "C-1", "--unknown"]), CliParseError);
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
