#!/usr/bin/env node
// Real-CLI gate for the runner boundary (QK-RUN-007, extended for QK-RUN-009).
//
// Dispatches every configured profile against the real agent CLI through the
// production CliRunnerPort and the production managing-agent interpreter, then
// asserts on the *body* of the result rather than on an exit code: the verdict,
// the quote behind it, and whether that quote is really in the retained
// transcript.
//
// Fake runners cannot observe CLI flag validity, sandbox behaviour, or output
// shape. Three of the four defects that cost the cmp-uimotion-1 campaign were
// invisible to a fully green test suite, and the post-fix probe passed 9/9 on
// exit code while two of three codex models were writing envelopes the parser
// would reject. A green exit code is not a green result.
//
// Usage:
//   node scripts/quirks-runner-probe.mjs                 # every configured profile
//   node scripts/quirks-runner-probe.mjs --profile <id>  # one profile (repeatable)
//   node scripts/quirks-runner-probe.mjs --out report.json
//   node scripts/quirks-runner-probe.mjs --concurrency 3

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/src");
const { CliRunnerPort } = await import(`${distRoot}/runner/cli-runner-port.js`);
const { loadRunnerProfiles } = await import(`${distRoot}/runner/profiles.js`);
const { loadInterpreterConfig } = await import(`${distRoot}/runner/managing-agent/config.js`);
const { ManagingAgentInterpreter } = await import(`${distRoot}/runner/managing-agent/interpreter.js`);
const { quoteSupportedByTranscript } = await import(`${distRoot}/runner/managing-agent/contract.js`);

/** A defect a reviewer cannot honestly accept: the loop reads one past the end. */
const DEFECTIVE_SOURCE = `export function sumFirstN(values, n) {
  let total = 0;
  for (let index = 0; index <= n; index += 1) {
    total += values[index];
  }
  return total;
}
`;

const REVIEW_BRIEF = `# Review brief

Review \`sum.js\` in this repository.

Report every defect you find, with file and line references. Finish your final
message with an explicit recommendation in your own words: accept the code as
it stands, or revise it.

You are read-only. Do not modify any file.
`;

const IMPLEMENT_BRIEF = `# Implementation brief

\`sum.js\` in this repository sums the first \`n\` elements, but its loop bound
reads one element past the end. Fix it, then commit with the message
"fix: correct the loop bound".
`;

function parseArgs(argv) {
  const args = { profiles: [], out: undefined, concurrency: 3 };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--profile") { args.profiles.push(argv[++index]); continue; }
    if (flag === "--out") { args.out = argv[++index]; continue; }
    if (flag === "--concurrency") { args.concurrency = Number(argv[++index]) || 3; continue; }
  }
  return args;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout }));
  });
}

async function scratchRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-probe-repo-"));
  await writeFile(path.join(root, "sum.js"), DEFECTIVE_SOURCE, "utf8");
  await run("git", ["init", "-q", "."], { cwd: root });
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", [
    "-c", "user.email=probe@quirks.local", "-c", "user.name=Quirks Probe",
    "commit", "-qm", "init",
  ], { cwd: root });
  return root;
}

/**
 * A read-only profile reviews; a write-capable one implements. This mirrors how
 * the supervisor routes roles, so the probe exercises the same paths.
 */
function roleFor(profile) {
  return profile.capabilities.includes("repository-write") ? "implementer" : "reviewer";
}

async function probeProfile(profile, interpreter) {
  const started = Date.now();
  const role = roleFor(profile);
  const worktreePath = await scratchRepository();
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-probe-artifacts-"));
  const briefPath = path.join(artifactDir, "brief.md");
  // No envelope contract anywhere in the brief: the point of QK-RUN-009 is that
  // the CLI is left to speak naturally and the agent derives the structure.
  await writeFile(briefPath, role === "reviewer" ? REVIEW_BRIEF : IMPLEMENT_BRIEF, "utf8");

  const port = new CliRunnerPort(new Map([[profile.profileId, profile]]), interpreter);
  const jobId = `probe:${profile.profileId}:${role}:1`;

  const failures = [];
  let result;
  try {
    result = await port.dispatch({
      jobId,
      taskId: "PROBE-1",
      role,
      route: {
        profileId: profile.profileId,
        runnerType: profile.runnerType,
        tier: profile.tier,
        effort: profile.effort,
        quotaPoolId: profile.quotaPoolId,
      },
      briefPath,
      worktreePath,
    });
  } catch (error) {
    return {
      profileId: profile.profileId,
      runnerType: profile.runnerType,
      model: profile.model,
      role,
      pass: false,
      elapsedMs: Date.now() - started,
      failures: [`dispatch threw: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const transcriptFile = result.artifactPaths.find((entry) => entry.includes("/transcript-"));
  const transcript = transcriptFile ? await readFile(transcriptFile, "utf8").catch(() => "") : "";
  const record = result.interpretationPath
    ? JSON.parse(await readFile(result.interpretationPath, "utf8").catch(() => "null"))
    : null;

  if (result.status !== "success") {
    failures.push(`status ${result.status} (${result.failure?.code ?? "no code"}: ${result.failure?.message ?? ""})`);
  }
  if (!transcriptFile) failures.push("no transcript was retained");
  if (!record) failures.push("no interpretation record was retained");

  if (role === "reviewer") {
    // The file under review has a real off-by-one, so a reviewer that accepts
    // it has either not read it or has been misread. Both are gate failures.
    if (result.verdict !== "revise") {
      failures.push(`verdict ${result.verdict ?? "(none)"} — expected revise on a file with a real off-by-one`);
    }
    if (!result.verdictEvidence) {
      failures.push("verdict carried no supporting quote");
    } else if (!quoteSupportedByTranscript(result.verdictEvidence, transcript)) {
      failures.push("the verdict quote is not present in the retained transcript");
    }
    const findings = record?.report?.findings ?? [];
    if (findings.length === 0) {
      failures.push("no findings survived interpretation");
    }
  } else if (result.verdict !== undefined) {
    failures.push(`an implementer job carried verdict ${result.verdict}`);
  }

  return {
    profileId: profile.profileId,
    runnerType: profile.runnerType,
    model: profile.model,
    role,
    pass: failures.length === 0,
    status: result.status,
    verdict: result.verdict ?? null,
    verdictEvidence: result.verdictEvidence ?? null,
    findingsCount: record?.report?.findings?.length ?? 0,
    interpreterAttempts: record?.checks?.attempts ?? null,
    interpreterCostUsd: record?.interpreterCostUsd ?? null,
    transcriptBytes: record?.transcriptBytes ?? transcript.length,
    elapsedMs: Date.now() - started,
    transcriptPath: transcriptFile ?? null,
    interpretationPath: result.interpretationPath ?? null,
    failures,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let next = 0;
  async function pump() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
      process.stderr.write(`  ${results[index].pass ? "PASS" : "FAIL"} ${results[index].profileId}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const all = await loadRunnerProfiles();
  const selected = args.profiles.length > 0
    ? all.filter((profile) => args.profiles.includes(profile.profileId))
    : all;
  if (selected.length === 0) {
    process.stderr.write("no matching profiles\n");
    process.exit(2);
  }

  const config = await loadInterpreterConfig();
  const interpreter = new ManagingAgentInterpreter(config);
  process.stderr.write(
    `probing ${selected.length} profile(s) with interpreter ${config.executable} (${config.model})\n`,
  );

  const results = await mapWithConcurrency(selected, args.concurrency, (profile) =>
    probeProfile(profile, interpreter));

  const passed = results.filter((entry) => entry.pass).length;
  const report = {
    schemaVersion: 1,
    interpreter: { executable: config.executable, model: config.model },
    passed,
    total: results.length,
    results,
  };
  if (args.out) await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`\n| Profile | Runner | Model | Role | Status | Verdict | Findings | Quote in transcript | Result |\n`);
  process.stdout.write(`|---|---|---|---|---|---|---|---|---|\n`);
  for (const entry of results) {
    const quoteOk = entry.role === "reviewer"
      ? (entry.failures.some((failure) => failure.includes("quote")) ? "no" : "yes")
      : "n/a";
    process.stdout.write(
      `| \`${entry.profileId}\` | ${entry.runnerType} | ${entry.model} | ${entry.role} | ${entry.status ?? "—"} | ${entry.verdict ?? "—"} | ${entry.findingsCount} | ${quoteOk} | ${entry.pass ? "**PASS**" : `**FAIL** — ${entry.failures.join("; ")}`} |\n`,
    );
  }
  process.stdout.write(`\n${passed}/${results.length} passed\n`);
  process.exitCode = passed === results.length ? 0 : 1;
}

await main();
