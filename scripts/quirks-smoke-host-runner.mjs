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
import { SMOKE_APPROVAL_ENV, SMOKE_MATRIX, SMOKE_POC_CELL } from "../dist/src/smoke/types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    all: false,
    poc: false,
    host: undefined,
    runner: undefined,
    evidenceDir: path.join(repoRoot, ".superpowers/sdd/qk-dgf-002/smoke"),
    writeMatrixDoc: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") {
      options.all = true;
      options.writeMatrixDoc = true;
      continue;
    }
    if (token === "--poc") {
      options.poc = true;
      continue;
    }
    if (token === "--write-matrix-doc") {
      options.writeMatrixDoc = true;
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
  if (options.all && options.poc) {
    throw new Error("Specify only one of --all or --poc");
  }
  if (!options.all && !options.poc && (!options.host || !options.runner)) {
    throw new Error("Specify --all, --poc, or both --host and --runner");
  }
  return options;
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  if (process.env.QUIRKS_SMOKE_APPROVED !== SMOKE_APPROVAL_ENV) {
    throw new Error(`Set QUIRKS_SMOKE_APPROVED=${SMOKE_APPROVAL_ENV}`);
  }

  const options = parseArgs(process.argv.slice(2));
  const cells = options.all
    ? SMOKE_MATRIX
    : options.poc
      ? [{
          host: options.host ?? SMOKE_POC_CELL.host,
          runner: options.runner ?? SMOKE_POC_CELL.runner,
        }]
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
  const timings = [];
  const suiteStarted = Date.now();

  for (const cell of cells) {
    const cellStarted = Date.now();
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
    const elapsedMs = Date.now() - cellStarted;
    timings.push({ cell: `${cell.host}/${cell.runner}`, outcome: evidence.outcome, elapsedMs });
    const deviationSuffix = evidence.deviations.length > 0
      ? ` (${evidence.deviations.join(", ")})`
      : "";
    process.stdout.write(
      `${cell.host}/${cell.runner}: ${evidence.outcome}${deviationSuffix} [${formatMs(elapsedMs)}]\n`,
    );
  }

  const totalMs = Date.now() - suiteStarted;
  process.stdout.write(`\nTiming summary (${cells.length} cell(s), total ${formatMs(totalMs)}):\n`);
  for (const row of timings) {
    process.stdout.write(`  ${row.cell}: ${row.outcome} ${formatMs(row.elapsedMs)}\n`);
  }

  if (options.writeMatrixDoc) {
    const markdown = projectMatrixMarkdown(records);
    await writeFile(path.join(repoRoot, "docs/smoke/2026-host-matrix.md"), markdown, "utf8");
    process.stdout.write(`Wrote docs/smoke/2026-host-matrix.md (${records.length} record(s))\n`);
  }

  await rm(configDir, { recursive: true, force: true });
}

await main();
