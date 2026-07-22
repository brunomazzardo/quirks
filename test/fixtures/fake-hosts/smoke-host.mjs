#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

function parseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("empty CLI output");
  return JSON.parse(trimmed);
}

async function runCampaignCli(cli, args, cwd, env) {
  const executable = cli.endsWith(".js") ? process.execPath : cli;
  const argv = cli.endsWith(".js") ? [cli, ...args] : args;
  const { stdout } = await execFileAsync(executable, argv, {
    cwd,
    env,
    maxBuffer: 1_048_576,
  });
  return parseJson(stdout);
}

function digestPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function main() {
  const campaignCli = process.env.QUIRKS_SMOKE_CAMPAIGN_CLI;
  const fixtureRoot = process.env.QUIRKS_SMOKE_FIXTURE_ROOT;
  const stateDir = process.env.QUIRKS_SMOKE_STATE_DIR;
  const configDir = process.env.QUIRKS_CONFIG_DIR;
  const evidencePath = process.env.QUIRKS_SMOKE_EVIDENCE_PATH;
  const host = process.env.QUIRKS_SMOKE_HOST;
  const runner = process.env.QUIRKS_SMOKE_RUNNER;
  const taskId = process.env.QUIRKS_SMOKE_TASK_ID ?? "QK-101";

  if (!campaignCli || !fixtureRoot || !stateDir || !configDir || !evidencePath || !host || !runner) {
    process.exitCode = 2;
    return;
  }

  const env = {
    ...process.env,
    QUIRKS_STATE_DIR: stateDir,
    QUIRKS_CONFIG_DIR: configDir,
  };

  const deviations = [];
  let outcome = "failed";
  let sessionAvailable = false;
  let artifactDigest = "n/a";
  let profileId = `smoke-implementer-${runner}`;
  let model = process.env.QUIRKS_SMOKE_MODEL ?? "n/a";
  let effort = process.env.QUIRKS_SMOKE_EFFORT ?? "n/a";

  try {
    const preflight = await runCampaignCli(
      campaignCli,
      ["preflight", "--task", taskId, "--external-routing", "--json"],
      fixtureRoot,
      env,
    );
    if (!preflight.ok) {
      outcome = "blocked";
      deviations.push("preflight-blocked");
      await writeFile(
        evidencePath,
        `${JSON.stringify({
          schemaVersion: 1,
          date: new Date().toISOString().slice(0, 10),
          os: process.platform,
          host,
          hostVersion: process.env.QUIRKS_SMOKE_HOST_VERSION ?? "smoke-host",
          runner,
          runnerVersion: process.env.QUIRKS_SMOKE_RUNNER_VERSION ?? runner,
          model,
          effort,
          profileId,
          outcome,
          sessionAvailable: false,
          artifactDigest,
          deviations,
        }, null, 2)}\n`,
      );
      return;
    }

    const route = preflight.envelope?.routing?.[taskId]?.primary;
    if (route?.profileId) {
      profileId = route.profileId;
      model = route.profileId;
      effort = route.effort ?? effort;
    }

    await runCampaignCli(
      campaignCli,
      ["approve", "--campaign", preflight.campaignId, "--digest", preflight.envelope.digest, "--json"],
      fixtureRoot,
      env,
    );
    const start = await runCampaignCli(
      campaignCli,
      ["start", "--campaign", preflight.campaignId, "--json"],
      fixtureRoot,
      env,
    );
    const status = await runCampaignCli(
      campaignCli,
      ["status", "--campaign", preflight.campaignId, "--json"],
      fixtureRoot,
      env,
    );

    sessionAvailable = Array.isArray(status.sessions) && status.sessions.length > 0;
    artifactDigest = digestPayload({
      campaignId: preflight.campaignId,
      dispatchedJobs: Array.isArray(start.dispatchedJobs) ? start.dispatchedJobs.length : 0,
      sessionCount: Array.isArray(status.sessions) ? status.sessions.length : 0,
    });
    outcome = start.ok === true && sessionAvailable ? "passed" : "failed";
    if (!sessionAvailable) deviations.push("missing-session");
    if (start.ok !== true) deviations.push("start-failed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "host-orchestration-failed";
    if (/usage|quota|rate.?limit/i.test(message)) {
      outcome = "blocked";
      deviations.push("usage-limit");
    } else {
      outcome = "failed";
      deviations.push("host-orchestration-failed");
    }
  }

  await writeFile(
    evidencePath,
    `${JSON.stringify({
      schemaVersion: 1,
      date: new Date().toISOString().slice(0, 10),
      os: process.platform,
      host,
      hostVersion: process.env.QUIRKS_SMOKE_HOST_VERSION ?? "smoke-host",
      runner,
      runnerVersion: process.env.QUIRKS_SMOKE_RUNNER_VERSION ?? runner,
      model,
      effort,
      profileId,
      outcome,
      sessionAvailable,
      artifactDigest,
      deviations,
    }, null, 2)}\n`,
  );
}

await main();
