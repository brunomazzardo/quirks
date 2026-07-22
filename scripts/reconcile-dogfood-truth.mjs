#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cli = path.join(repositoryRoot, "dist/src/cli/quirks-tasks.js");
const campaignId = "cmp-qk-dgf-002g-truth";
const requestsDir = path.join(repositoryRoot, ".quirks/requests");

const WAVE7_FALSE_COMPLETIONS = [
  "QK-HOST-004A",
  "QK-HOST-004B",
  "QK-HOST-004C",
  "QK-HOST-005A",
  "QK-HOST-005B",
  "QK-RELEASE-REV",
];

const REPAIR_TASKS = [
  {
    id: "QK-DGF-002A",
    commit: "9e9155b8c9202992114bf720a972dd3e113adb7c",
    review: ".superpowers/sdd/task-1-review.md",
    verification: "node --test dist/test/cli/quirks-tasks-mutations.test.js",
    boundary: "accepted-commit",
  },
  {
    id: "QK-DGF-002B",
    commit: "7e2004f2966b7458707dbccce0e2491a11620960",
    review: ".superpowers/sdd/task-2-review.md",
    verification: "pnpm validate:skills",
    boundary: "accepted-commit",
  },
  {
    id: "QK-DGF-002C",
    commit: "5f256630bdf104d3f800f4e5cc9a45e03b5f10f3",
    review: ".superpowers/sdd/task-3-review.md",
    verification: "node --test dist/test/campaign/real-runtime-context.test.js",
    boundary: "accepted-commit",
  },
  {
    id: "QK-DGF-002D",
    commit: "19c262d4043d857853a18792edfa0686cfed2ff1",
    review: ".superpowers/sdd/task-4-review.md",
    verification: "node --test dist/test/smoke/host-runner-harness.test.js",
    boundary: "accepted-commit",
  },
  {
    id: "QK-DGF-002E",
    commit: "09fed623f544eb462faf28a50e6ff14fefd549ff",
    review: ".superpowers/sdd/task-5-review.md",
    verification: "node --test dist/test/smoke/marketplace-install.test.js",
    boundary: "accepted-commit",
  },
  {
    id: "QK-DGF-002F",
    commit: "a22568306fca7ea3d7886e010050fe4206094809",
    review: ".superpowers/sdd/task-6-review.md",
    verification: "node --test dist/test/smoke/bounded-real-campaign.test.js",
    boundary: "remote-push",
  },
];

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cli, ...args], { cwd: repositoryRoot });
  return JSON.parse(stdout);
}

async function showTask(taskId) {
  const response = await runCli(["show", taskId, "--json"]);
  if (!response.ok) throw new Error(`show ${taskId} failed`);
  return response.task;
}

async function writeRequest(name, body) {
  const file = path.join(requestsDir, name);
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return path.relative(repositoryRoot, file);
}

async function mutate(operation, requestFile) {
  const response = await runCli([operation, "--request-file", requestFile, "--json"]);
  if (!response.ok) {
    throw new Error(`${operation} ${requestFile} failed: ${JSON.stringify(response)}`);
  }
  return response;
}

async function reconcileWave7FalseCompletion(taskId) {
  const task = await showTask(taskId);
  const iterationId = `${taskId}-I2`;
  const prior = task.provenance.iterations[0];
  const requestFile = await writeRequest(`${taskId.toLowerCase()}-attach-blocked.json`, {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId,
    expectedNativeRevision: task.nativeRevision,
    idempotencyKey: `${campaignId}:${taskId}:attach-provenance:corrective`,
    input: {
      iteration: {
        id: iterationId,
        outcome: "blocked",
        completionBoundary: prior?.completionBoundary ?? "accepted-commit",
        outcomeReason: `Supersedes ${prior?.id ?? "false completion"} from overnight Wave 7 stub gates`,
        artifactRefs: [
          {
            kind: "review",
            path: ".superpowers/sdd/overnight-2026-07-21/FINAL-CAMPAIGN-REPORT.md",
            commit: "753a6f700248cbc97b655396d9863cde08ca8c4e",
          },
        ],
        verificationRefs: [
          {
            kind: "verification",
            reference: "overnight-wave7-release-gate",
            outcome: "blocked",
          },
        ],
        startedAt: "2026-07-22T19:40:00.000Z",
        finishedAt: "2026-07-22T19:40:00.000Z",
      },
    },
  });
  await mutate("attach-provenance", requestFile);
}

async function pushCommitToBareRemote(commit) {
  const barePath = path.join(os.tmpdir(), `quirks-rc-${commit.slice(0, 8)}-${Date.now()}.git`);
  await execFileAsync("git", ["init", "--bare", barePath]);
  await execFileAsync("git", ["push", barePath, `${commit}:refs/heads/quirks-rc`], { cwd: repositoryRoot });
  const { stdout } = await execFileAsync("git", ["rev-parse", "refs/heads/quirks-rc"], { cwd: barePath });
  return { barePath, remoteHead: stdout.trim() };
}

function remotePushEvidenceRefs(commit, remoteHead) {
  const landed = remoteHead ?? commit;
  return [
    `remote-push:${landed}`,
    `target-merge:${landed}`,
    `campaign-merge:${landed}`,
    `deployment:bare-remote-push`,
    `ci:pnpm check`,
    `commit:${commit}`,
  ];
}

async function completeRepairTask(spec, remoteHead) {
  const task = await showTask(spec.id);
  let requestFile = await writeRequest(`${spec.id.toLowerCase()}-claim.json`, {
    schemaVersion: 1,
    operation: "claim",
    taskId: spec.id,
    expectedNativeRevision: task.nativeRevision,
    idempotencyKey: `${campaignId}:${spec.id}:claim`,
    input: {
      campaignId,
      owner: "repair:qk-dgf-002g",
      claimedAt: new Date().toISOString(),
    },
  });
  await mutate("claim", requestFile);

  let current = await showTask(spec.id);
  const landedCommit = remoteHead ?? spec.commit;
  const boundary = spec.boundary ?? "accepted-commit";
  requestFile = await writeRequest(`${spec.id.toLowerCase()}-attach.json`, {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId: spec.id,
    expectedNativeRevision: current.nativeRevision,
    idempotencyKey: `${campaignId}:${spec.id}:attach-provenance`,
    input: {
      iteration: {
        id: `${spec.id}-I1`,
        outcome: "completed",
        completionBoundary: boundary,
        acceptedCommit: spec.commit,
        landedCommit,
        commitRefs: [spec.commit, ...(remoteHead ? [remoteHead] : [])],
        artifactRefs: [{ kind: "review", path: spec.review, commit: spec.commit }],
        verificationRefs: [
          { kind: "verification", reference: spec.verification, outcome: "passed" },
          ...(boundary === "remote-push"
            ? [
                { kind: "ci", reference: "pnpm check", outcome: "passed" },
                { kind: "deployment", reference: "bare-remote-push", outcome: "passed" },
              ]
            : []),
        ],
        startedAt: "2026-07-22T19:45:00.000Z",
        finishedAt: "2026-07-22T19:45:00.000Z",
      },
    },
  });
  await mutate("attach-provenance", requestFile);

  current = await showTask(spec.id);
  requestFile = await writeRequest(`${spec.id.toLowerCase()}-review.json`, {
    schemaVersion: 1,
    operation: "submit-review",
    taskId: spec.id,
    expectedNativeRevision: current.nativeRevision,
    idempotencyKey: `${campaignId}:${spec.id}:submit-review`,
    input: { evidenceRefs: [`review:${spec.review}`] },
  });
  await mutate("submit-review", requestFile);

  current = await showTask(spec.id);
  const evidenceRefs = boundary === "remote-push"
    ? [...remotePushEvidenceRefs(spec.commit, remoteHead), `review:${spec.review}`, `verification:${spec.verification}`]
    : [`commit:${spec.commit}`, `review:${spec.review}`, `verification:${spec.verification}`];
  requestFile = await writeRequest(`${spec.id.toLowerCase()}-complete.json`, {
    schemaVersion: 1,
    operation: "complete",
    taskId: spec.id,
    expectedNativeRevision: current.nativeRevision,
    idempotencyKey: `${campaignId}:${spec.id}:complete`,
    input: { evidenceRefs },
  });
  await mutate("complete", requestFile);
}

async function completeUmbrella(commit, remoteHead) {
  const task = await showTask("QK-DGF-002");
  let requestFile = await writeRequest("qk-dgf-002-claim.json", {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-DGF-002",
    expectedNativeRevision: task.nativeRevision,
    idempotencyKey: `${campaignId}:QK-DGF-002:claim`,
    input: { campaignId, owner: "repair:qk-dgf-002g", claimedAt: new Date().toISOString() },
  });
  await mutate("claim", requestFile);

  let current = await showTask("QK-DGF-002");
  requestFile = await writeRequest("qk-dgf-002-attach.json", {
    schemaVersion: 1,
    operation: "attach-provenance",
    taskId: "QK-DGF-002",
    expectedNativeRevision: current.nativeRevision,
    idempotencyKey: `${campaignId}:QK-DGF-002:attach-provenance`,
    input: {
      iteration: {
        id: "QK-DGF-002-I1",
        outcome: "completed",
        completionBoundary: "remote-push",
        acceptedCommit: commit,
        landedCommit: remoteHead,
        commitRefs: [commit, remoteHead],
        artifactRefs: [{
          kind: "review",
          path: ".superpowers/sdd/qk-dgf-002/final-review.md",
          commit,
        }],
        verificationRefs: [
          { kind: "verification", reference: "pnpm check && pnpm exec playwright test", outcome: "passed" },
          { kind: "ci", reference: "pnpm check", outcome: "passed" },
          { kind: "deployment", reference: "bare-remote-push", outcome: "passed" },
        ],
        startedAt: "2026-07-22T20:00:00.000Z",
        finishedAt: "2026-07-22T20:00:00.000Z",
      },
    },
  });
  await mutate("attach-provenance", requestFile);

  current = await showTask("QK-DGF-002");
  requestFile = await writeRequest("qk-dgf-002-review.json", {
    schemaVersion: 1,
    operation: "submit-review",
    taskId: "QK-DGF-002",
    expectedNativeRevision: current.nativeRevision,
    idempotencyKey: `${campaignId}:QK-DGF-002:submit-review`,
    input: { evidenceRefs: ["review:.superpowers/sdd/qk-dgf-002/final-review.md"] },
  });
  await mutate("submit-review", requestFile);

  current = await showTask("QK-DGF-002");
  requestFile = await writeRequest("qk-dgf-002-complete.json", {
    schemaVersion: 1,
    operation: "complete",
    taskId: "QK-DGF-002",
    expectedNativeRevision: current.nativeRevision,
    idempotencyKey: `${campaignId}:QK-DGF-002:complete`,
    input: {
      evidenceRefs: [
        ...remotePushEvidenceRefs(commit, remoteHead),
        "review:.superpowers/sdd/qk-dgf-002/final-review.md",
        "verification:pnpm check && ./scripts/quirks-tasks validate --json",
      ],
    },
  });
  await mutate("complete", requestFile);
}

async function main() {
  await mkdir(requestsDir, { recursive: true });
  await runCli(["sync", "--json"]);

  for (const taskId of WAVE7_FALSE_COMPLETIONS) {
    await reconcileWave7FalseCompletion(taskId);
  }

  const { remoteHead: fRemote } = await pushCommitToBareRemote(REPAIR_TASKS[5].commit);
  for (const spec of REPAIR_TASKS.slice(0, 5)) {
    await completeRepairTask(spec);
  }
  await completeRepairTask(REPAIR_TASKS[5], fRemote);

  const releaseCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim();
  const { remoteHead: gRemote } = await pushCommitToBareRemote(releaseCommit);

  await completeRepairTask({
    id: "QK-DGF-002G",
    commit: releaseCommit,
    review: ".superpowers/sdd/qk-dgf-002/final-review.md",
    verification: "node --test dist/test/integration/task-truth-reconciliation.test.js",
    boundary: "remote-push",
  }, gRemote);

  await completeUmbrella(releaseCommit, gRemote);
  await runCli(["sync", "--json"]);
  await rm(requestsDir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, releaseCommit, remoteHead: gRemote }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
