#!/usr/bin/env node
/**
 * Fast smoke gate — no host CLIs, no paid approval.
 * Times the suite and fails if it exceeds the budget.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_MS = Number(process.env.QUIRKS_SMOKE_FAST_BUDGET_MS ?? 60_000);

const tests = [
  "dist/test/smoke/host-runner-argv.test.js",
  "dist/test/smoke/host-runner-harness.test.js",
];

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: process.env,
      ...opts,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

const started = Date.now();
await run("pnpm", ["build"]);
await run(process.execPath, ["--test", ...tests]);
const elapsedMs = Date.now() - started;
process.stdout.write(`smoke:fast ok in ${(elapsedMs / 1000).toFixed(2)}s (budget ${(BUDGET_MS / 1000).toFixed(0)}s)\n`);
if (elapsedMs > BUDGET_MS) {
  process.exitCode = 1;
  process.stderr.write(`smoke:fast exceeded budget: ${elapsedMs}ms > ${BUDGET_MS}ms\n`);
}
