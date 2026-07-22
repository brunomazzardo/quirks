#!/usr/bin/env node
import { access, constants } from "node:fs/promises";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { persistEvidence, projectMatrixMarkdown } from "../dist/src/smoke/evidence.js";
import {
  installSmokeHostExecutable,
  prepareSmokeFixtureRoot,
  runHostRunnerCell,
  writeSmokeHostsConfig,
  writeSmokeProfilesConfig,
} from "../dist/src/smoke/host-runner.js";
import { SMOKE_APPROVAL_ENV, SMOKE_MATRIX } from "../dist/src/smoke/types.js";

const execFileAsync = promisify(execFile);
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

async function resolveExecutable(name) {
  const searchPath = process.env.PATH?.split(path.delimiter) ?? [];
  for (const directory of searchPath) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return undefined;
}

async function probeVersion(executable) {
  try {
    const { stdout } = await execFileAsync(executable, ["--version"], { timeout: 15_000 });
    return stdout.trim().split("\n")[0].slice(0, 64);
  } catch {
    return "unknown";
  }
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
  if (!claude || !codex || !cursor) {
    throw new Error("Missing one or more runner executables on PATH");
  }

  const smokeHost = await installSmokeHostExecutable(configDir);
  await writeSmokeHostsConfig(configDir, {
    claude: smokeHost,
    codex: smokeHost,
    cursor: smokeHost,
  });

  const hostVersions = {
    claude: await probeVersion(claude),
    codex: await probeVersion(codex),
    cursor: await probeVersion(cursor),
  };
  const runnerVersions = {
    claude: await probeVersion(claude),
    codex: await probeVersion(codex),
    cursor: await probeVersion(cursor),
  };

  const records = [];
  for (const cell of cells) {
    const cellFixtureRoot = await prepareSmokeFixtureRoot();
    await writeSmokeProfilesConfig(configDir, { claude, codex, cursor }, cell.runner);
    const { evidence: rawEvidence } = await runHostRunnerCell({
      host: cell.host,
      runner: cell.runner,
      fixtureRoot: cellFixtureRoot,
      configDir,
      approved: true,
      evidenceDir: options.evidenceDir,
      campaignCli: path.join(repoRoot, "dist/src/cli/quirks-campaign.js"),
      hostExecutables: {
        claude: smokeHost,
        codex: smokeHost,
        cursor: smokeHost,
      },
    });
    const evidence = {
      ...rawEvidence,
      hostVersion: hostVersions[cell.host],
      runnerVersion: runnerVersions[cell.runner],
      deviations: rawEvidence.deviations.includes("host-orchestrator-fallback")
        ? rawEvidence.deviations
        : [...rawEvidence.deviations, "host-orchestrator-shim"],
    };
    await persistEvidence(evidence, options.evidenceDir);
    records.push(evidence);
    process.stdout.write(`${cell.host}/${cell.runner}: ${evidence.outcome}\n`);
  }

  const markdown = projectMatrixMarkdown(records);
  await writeFile(path.join(repoRoot, "docs/smoke/2026-host-matrix.md"), markdown, "utf8");
  await rm(configDir, { recursive: true, force: true });
}

await main();
