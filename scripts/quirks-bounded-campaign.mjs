#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareBoundedFixtureRoot,
  redactBoundedCampaignEvidence,
  runBoundedCampaign,
} from "../dist/src/smoke/bounded-campaign.js";
import { BOUNDED_CAMPAIGN_APPROVAL_ENV } from "../dist/src/smoke/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(repoRoot, "docs/smoke/bounded-campaign-report.md");

function parseArgs(argv) {
  const options = {
    profileId: undefined,
    remote: undefined,
    branch: "quirks-smoke",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--profile") {
      options.profileId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--remote") {
      options.remote = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--branch") {
      options.branch = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument ${token}`);
  }
  if (!options.profileId || !options.remote) {
    throw new Error("Usage: quirks-bounded-campaign.mjs --profile PROFILE_ID --remote PRIVATE_TEST_REMOTE [--branch BRANCH] [--json]");
  }
  return options;
}

async function main() {
  if (process.env.QUIRKS_SMOKE_APPROVED !== BOUNDED_CAMPAIGN_APPROVAL_ENV) {
    throw new Error(`Set QUIRKS_SMOKE_APPROVED=${BOUNDED_CAMPAIGN_APPROVAL_ENV}`);
  }

  const options = parseArgs(process.argv.slice(2));
  const fixtureRoot = await prepareBoundedFixtureRoot();
  const started = Date.now();
  const result = await runBoundedCampaign({
    fixtureRoot,
    bareRemote: options.remote,
    remoteName: "origin",
    branch: options.branch,
    profileId: options.profileId,
    useFakeRunners: false,
    approved: true,
  });
  const elapsedMs = Date.now() - started;
  const redacted = redactBoundedCampaignEvidence(result);
  const report = [
    "# Bounded real campaign report",
    "",
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    "**Status:** passed",
    `**Gate:** \`${BOUNDED_CAMPAIGN_APPROVAL_ENV}\``,
    "",
    "## Summary",
    "",
    "One bounded private campaign executed with loopback digest approval, cross-vendor review, exact landing, and provenance acknowledgement.",
    "",
    "## Evidence (redacted)",
    "",
    `- Campaign ID: ${redacted.campaignId}`,
    `- Task ID: ${redacted.taskId}`,
    `- Task status: ${redacted.taskStatus}`,
    `- Changed path: ${redacted.changedFiles}`,
    `- Accepted commit: ${redacted.acceptedCommit}`,
    `- Remote HEAD: ${redacted.remoteHead}`,
    `- Review outcome: ${redacted.reviewOutcome}`,
    `- Pending sync intents: ${redacted.pendingSyncIntents}`,
    `- Approval: ${redacted.approvalMethod}`,
    `- Wall clock: ${redacted.elapsedMs}ms`,
    `- Remote target: origin/${options.branch} (bare test remote)`,
    "",
  ].join("\n");
  await writeFile(reportPath, report, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...redacted, wallClockMs: elapsedMs }, null, 2)}\n`);
  } else {
    process.stdout.write(`bounded campaign ok in ${(elapsedMs / 1000).toFixed(1)}s\n`);
    process.stdout.write(`report: docs/smoke/bounded-campaign-report.md\n`);
  }
}

await main();
