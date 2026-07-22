#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultHostRoots,
  installAllHosts,
} from "../hosts/shared/marketplace-install.mjs";

const APPROVAL_ENV = "approve-marketplace-install";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ all: boolean; source: string; json: boolean; roots?: { claude: string; codex: string; cursor: string } }} */
  const options = {
    all: false,
    source: repoRoot,
    json: false,
    roots: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all") {
      options.all = true;
      continue;
    }
    if (token === "--source") {
      options.source = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--claude-root") {
      options.roots ??= defaultHostRoots();
      options.roots.claude = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--codex-root") {
      options.roots ??= defaultHostRoots();
      options.roots.codex = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--cursor-root") {
      options.roots ??= defaultHostRoots();
      options.roots.cursor = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${token}`);
  }
  if (!options.all) {
    throw new Error("Specify --all to install across supported hosts");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const usingDefaultRoots = !options.roots;
  const roots = options.roots ?? defaultHostRoots();
  if (usingDefaultRoots && process.env.QUIRKS_SMOKE_APPROVED !== APPROVAL_ENV) {
    throw new Error(`Set QUIRKS_SMOKE_APPROVED=${APPROVAL_ENV} to install into user host directories`);
  }
  const hosts = await installAllHosts({ sourceRoot: options.source, roots });
  const payload = { ok: true, hosts };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

await main();
