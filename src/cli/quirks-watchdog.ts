#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CampaignStore } from "../campaign/store.js";
import { QuirksError } from "../core/errors.js";
import { reattachWatchdog } from "../runner/watchdog.js";

function usage(): never {
  process.stderr.write("Usage: quirks-watchdog --state-dir <dir> --repository-id <id> --campaign <id> --job <id>\n");
  process.exit(2);
}

function parseArgs(argv: readonly string[]): {
  stateDir: string;
  repositoryId: string;
  campaignId: string;
  jobId: string;
} {
  let stateDir: string | undefined;
  let repositoryId: string | undefined;
  let campaignId: string | undefined;
  let jobId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--state-dir") {
      stateDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--repository-id") {
      repositoryId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--campaign") {
      campaignId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--job") {
      jobId = argv[index + 1];
      index += 1;
      continue;
    }
    usage();
  }

  if (!stateDir || !repositoryId || !campaignId || !jobId) {
    usage();
  }

  return { stateDir, repositoryId, campaignId, jobId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const store = await CampaignStore.open(args.stateDir, args.repositoryId, args.campaignId);
  await readFile(path.join(store.artifactsPath, args.jobId, "heartbeat.json"), "utf8").catch(() => {
    throw new QuirksError("PROTOCOL_VIOLATION", `No heartbeat found for job ${args.jobId}`);
  });
  await reattachWatchdog(store, args.jobId);
}

await main();
