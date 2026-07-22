#!/usr/bin/env node
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { persistEvidence, projectMatrixMarkdown } from "../dist/src/smoke/evidence.js";
import {
  prepareSmokeFixtureRoot,
  resolveExecutable,
  runHostRunnerCell,
  writeSmokeHostsConfig,
  writeSmokeProfilesConfig,
} from "../dist/src/smoke/host-runner.js";
import { SMOKE_APPROVAL_ENV, SMOKE_MATRIX } from "../dist/src/smoke/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    all: false,
    host: undefined,
    runner: undefined,
    evidenceDir: path.join(repoRoot, ".superpowers/sdd/qk-dgf-002/smoke"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") {
      options.all = true;
      continue;
    }
    if (token === "--host") {
      options.host = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--runner") {
      options.runner = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--evidence-dir") {
      options.evidenceDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${token}`);
  }
  if (!options.all && (!options.host || !options.runner)) {
    throw new Error("Specify --all or both --host and --runner");
  }
  return options;
}

async function main() {
  if (process.env.QUIRKS_SMOKE_APPROVED !== SMOKE_APPROVAL_ENV) {
    throw new Error(`Set QUIRKS_SMOKE_APPROVED=${SMOKE_APPROVAL_ENV}`);
  }

  const options = parseArgs(process.argv.slice(2));
  const cells = options.all
    ? SMOKE_MATRIX
    : [{ host: options.host, runner: options.runner }];

  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-real-config-"));
  const claude = await resolveExecutable("claude");
  const codex = await resolveExecutable("codex");
  const cursor = await resolveExecutable("cursor-agent");

  await writeSmokeHostsConfig(configDir, {
    ...(claude ? { claude } : {}),
    ...(codex ? { codex } : {}),
    ...(cursor ? { cursor } : {}),
  });

  const records = [];
  for (const cell of cells) {
    const cellFixtureRoot = await prepareSmokeFixtureRoot();
    if (claude && codex && cursor) {
      await writeSmokeProfilesConfig(configDir, { claude, codex, cursor }, cell.runner);
    }
    const { evidence } = await runHostRunnerCell({
      host: cell.host,
      runner: cell.runner,
      fixtureRoot: cellFixtureRoot,
      configDir,
      approved: true,
      evidenceDir: options.evidenceDir,
      campaignCli: path.join(repoRoot, "dist/src/cli/quirks-campaign.js"),
    });
    await persistEvidence(evidence, options.evidenceDir);
    records.push(evidence);
    const deviationSuffix = evidence.deviations.length > 0
      ? ` (${evidence.deviations.join(", ")})`
      : "";
    process.stdout.write(`${cell.host}/${cell.runner}: ${evidence.outcome}${deviationSuffix}\n`);
  }

  const markdown = projectMatrixMarkdown(records);
  await writeFile(path.join(repoRoot, "docs/smoke/2026-host-matrix.md"), markdown, "utf8");
  await rm(configDir, { recursive: true, force: true });
}

await main();
