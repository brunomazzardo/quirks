#!/usr/bin/env node
// Capture a transcript from a real agent CLI, using the production argv
// builder, for use as an interpretation fixture.
//
// Fake runners cannot observe what a real CLI actually says: its prose shape,
// where a recommendation lands, whether reasoning survives at all. The
// managing-agent contract is tested against transcripts captured here rather
// than against hand-written imitations, because imitations are exactly what
// drifted from reality in QK-RUN-003/005.
//
// Usage:
//   node scripts/capture-runner-transcript.mjs \
//     --profile personal-claude-opus-review --role reviewer \
//     --scenario defective --out test/fixtures/real-transcripts/claude-reviewer-revise.jsonl
//
// Scenarios:
//   defective  reviewer brief over a file with an obvious off-by-one
//   clean      reviewer brief over the corrected file
//   summary    reviewer asked only to describe the file, so no judgment exists
//   implement  implementer brief asking for one concrete edit and a commit

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/src");
const { buildRunnerArgv, sanitizedRunnerEnv } = await import(`${distRoot}/runner/cli-runner-port.js`);
const { loadRunnerProfiles } = await import(`${distRoot}/runner/profiles.js`);
const { redactTranscript } = await import(`${distRoot}/runner/result-contract.js`);
const { redactHomePaths } = await import(`${distRoot}/prompt/untrusted-content.js`);

const DEFECTIVE_SOURCE = `export function sumFirstN(values, n) {
  let total = 0;
  for (let index = 0; index <= n; index += 1) {
    total += values[index];
  }
  return total;
}
`;

const CLEAN_SOURCE = DEFECTIVE_SOURCE.replace("index <= n", "index < n");

// A genuinely defensible implementation, used to capture an *accept* verdict.
// Merely fixing the off-by-one was not enough: a real opus reviewer given the
// corrected file still found six further defects and asked for changes, which
// is itself worth knowing — "clean enough for a fixture" is not a thing a
// reviewer agrees to.
const SOUND_SOURCE = `/**
 * Sum the first \`n\` elements of \`values\`.
 *
 * @param {readonly number[]} values numbers to sum from
 * @param {number} n how many leading elements to sum; an integer in [0, values.length]
 * @returns {number} the sum, 0 when n is 0
 * @throws {TypeError} when values is not an array of finite numbers
 * @throws {RangeError} when n is not an integer within range
 */
export function sumFirstN(values, n) {
  if (!Array.isArray(values)) {
    throw new TypeError("values must be an array");
  }
  if (!Number.isInteger(n) || n < 0 || n > values.length) {
    throw new RangeError(\`n must be an integer in [0, \${values.length}]\`);
  }
  let total = 0;
  for (let index = 0; index < n; index += 1) {
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(\`values[\${index}] must be a finite number\`);
    }
    total += value;
  }
  return total;
}
`;

const SOUND_TESTS = `import assert from "node:assert/strict";
import test from "node:test";
import { sumFirstN } from "./sum.js";

test("sums the first n elements", () => {
  assert.equal(sumFirstN([10, 20, 30], 2), 30);
});

test("sums the whole array when n is its length", () => {
  assert.equal(sumFirstN([1, 2, 3], 3), 6);
});

test("returns 0 when n is 0", () => {
  assert.equal(sumFirstN([1, 2, 3], 0), 0);
});

test("rejects n beyond the array", () => {
  assert.throws(() => sumFirstN([1, 2], 3), RangeError);
});

test("rejects a non-integer n", () => {
  assert.throws(() => sumFirstN([1, 2], 1.5), RangeError);
});

test("rejects non-numeric elements", () => {
  assert.throws(() => sumFirstN(["1", 2], 2), TypeError);
});

test("rejects a non-array", () => {
  assert.throws(() => sumFirstN("nope", 1), TypeError);
});
`;

const REVIEW_BRIEF = `# Review brief

Review \`sum.js\` in this repository.

Report every defect you find, with file and line references. Finish your final
message with an explicit recommendation in your own words: accept the code as
it stands, or revise it.

You are read-only. Do not modify any file.
`;

const SUMMARY_BRIEF = `# Description brief

Describe in two sentences what \`sum.js\` in this repository does.

Do not evaluate its quality, do not look for defects, and do not make any
recommendation about whether it should be accepted or changed.

You are read-only. Do not modify any file.
`;

const IMPLEMENT_BRIEF = `# Implementation brief

In this repository, add a \`sumAll(values)\` function to \`sum.js\` that returns
the sum of every element. Then commit the change with the message
"feat: add sumAll".
`;

const SOUND_BRIEF = `# Review brief

Review \`sum.js\` in this repository. Its tests are in \`sum.test.js\`.

Report any defect that must be fixed before this lands, with file and line
references. Finish your final message with an explicit recommendation in your
own words: accept the code as it stands, or revise it. Recommend accept if you
find nothing that must be fixed first.

You are read-only. Do not modify any file.
`;

const SCENARIOS = {
  defective: { source: DEFECTIVE_SOURCE, brief: REVIEW_BRIEF },
  clean: { source: CLEAN_SOURCE, brief: REVIEW_BRIEF },
  sound: { source: SOUND_SOURCE, brief: SOUND_BRIEF, extraFiles: { "sum.test.js": SOUND_TESTS } },
  summary: { source: DEFECTIVE_SOURCE, brief: SUMMARY_BRIEF },
  implement: { source: CLEAN_SOURCE, brief: IMPLEMENT_BRIEF },
};

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    args[flag.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function scratchRepository(source, extraFiles = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-capture-repo-"));
  await writeFile(path.join(root, "sum.js"), source, "utf8");
  for (const [name, contents] of Object.entries(extraFiles)) {
    await writeFile(path.join(root, name), contents, "utf8");
  }
  await run("git", ["init", "-q", "."], { cwd: root });
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", [
    "-c", "user.email=capture@quirks.local",
    "-c", "user.name=Quirks Capture",
    "commit", "-qm", "init",
  ], { cwd: root });
  return root;
}

async function main() {
  const args = parseArgs(process.argv);
  const scenario = SCENARIOS[args.scenario];
  if (!args.profile || !args.role || !args.out || !scenario) {
    process.stderr.write("usage: --profile <id> --role <implementer|reviewer> --scenario <defective|clean|summary|implement> --out <path>\n");
    process.exit(2);
  }

  const profiles = await loadRunnerProfiles();
  const profile = profiles.find((entry) => entry.profileId === args.profile);
  if (!profile) {
    process.stderr.write(`unknown profile ${args.profile}\n`);
    process.exit(2);
  }

  const worktreePath = await scratchRepository(scenario.source, scenario.extraFiles ?? {});
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "quirks-capture-artifacts-"));
  const briefPath = path.join(artifactDir, "brief.md");
  // No result-envelope contract: this fixture must show what a CLI says when it
  // is left to speak naturally, which is the whole point of QK-RUN-009.
  await writeFile(briefPath, scenario.brief, "utf8");

  const jobId = `capture-${args.profile}-${args.scenario}`;
  const argv = buildRunnerArgv(
    profile,
    { jobId, taskId: "CAPTURE-1", role: args.role, route: {}, briefPath, worktreePath },
    artifactDir,
    scenario.brief,
  );

  const env = sanitizedRunnerEnv(profile);
  const started = Date.now();
  const result = await run(argv[0], argv.slice(1), {
    cwd: worktreePath,
    env: { ...process.env, ...env },
  });
  const elapsedMs = Date.now() - started;

  // Home paths are redacted on top of the production secret redaction because
  // this transcript is committed: a fixture must not carry the operator's
  // directory layout into the repository.
  const redacted = redactHomePaths(redactTranscript(result.stdout));
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, redacted, "utf8");

  process.stdout.write(JSON.stringify({
    profile: profile.profileId,
    runnerType: profile.runnerType,
    model: profile.model,
    role: args.role,
    scenario: args.scenario,
    exitCode: result.code,
    elapsedMs,
    bytes: redacted.length,
    lines: redacted.split("\n").filter((line) => line.trim().length > 0).length,
    out: args.out,
    stderrTail: result.stderr.slice(-400),
  }, null, 2) + "\n");
}

await main();
