# Quirks Dogfood Release Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quirks capable of truthfully authoring and completing its own tasks, dispatching real Claude/Codex/Cursor runners through the durable control plane, exercising the nine-cell host/runner matrix, installing the plugin, and completing one bounded private campaign.

**Architecture:** Close the bootstrap boundary first by exposing every TaskSource mutation through `quirks-tasks` and making all shipped skill references resolvable. Then replace CLI-only fake campaign wiring with injected real runner/profile/worktree adapters while retaining fake adapters only behind explicit test configuration. Finally, drive actual host installations and a disposable private campaign through one redacted smoke harness, then reconcile the canonical task source through the repaired CLI.

**Tech Stack:** TypeScript 7, Node.js 24+, pnpm 10.30.3, Node test runner, existing argv-only runner adapters, Git worktrees, local JSON TaskSource, Playwright 1.54.2 for the approval UI.

## Global Constraints

- Never edit `.quirks/tasks.json` directly; every task mutation must use `quirks-tasks` with an expected native revision and idempotency key.
- Never interpolate task briefs, Git arguments, credentials, or runner flags through a shell.
- Workers cannot approve, merge, push, or mark canonical tasks complete.
- Real smoke uses disposable repositories and bounded deterministic edits; it never accesses production systems.
- Credentials remain owned by installed host CLIs and local user configuration; no credential value enters task JSON, reports, prompts, Git, stdout evidence, or packaged artifacts.
- No force-push, destructive permission bypass, silent model downgrade, or inferred remote/branch.
- All new behavior follows red-green-refactor and ends with an independently reproducible verification command.
- `main` remains untouched until the complete repair branch passes review and release verification.

---

### Task 1: Task-authority CLI and source-repository entrypoints (`QK-DGF-002A`)

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli/quirks-tasks.ts`
- Create: `src/cli/mutation-request.ts`
- Create: `scripts/quirks-tasks`
- Create: `scripts/quirks-campaign`
- Modify: `package.json`
- Modify: `test/cli/quirks-tasks.test.ts`
- Create: `test/cli/quirks-tasks-mutations.test.ts`

**Interfaces:**
- Consumes: `TaskSourceRequest`, `TaskSourceResponse`, `reconcileMutation`, `SyncOutbox`, and a repository-relative JSON request file.
- Produces: `quirks-tasks propose|claim|submit-review|attach-provenance|complete|block|release --request-file PATH --json` plus executable source-tree wrappers.

- [ ] **Step 1: Write failing parser and CLI tests**

```ts
test("mutation commands require a repository-relative request file", () => {
  assert.deepEqual(parseArgs(["propose", "--request-file", ".quirks/requests/propose.json", "--json"]), {
    command: "propose",
    requestFile: ".quirks/requests/propose.json",
    json: true,
  });
  assert.throws(() => parseArgs(["complete", "--request-file", "../outside.json"]), /repository-relative/);
});

test("propose mutates only through the configured task source", async () => {
  const result = await runTasksCli(fixture, ["propose", "--request-file", ".quirks/requests/propose.json", "--json"]);
  assert.equal(result.operation, "propose");
  assert.equal(result.ok, true);
  assert.equal((await showTask(fixture, "QK-DGF-TEST")).status, "ready");
});
```

- [ ] **Step 2: Run the focused tests and observe the missing-command failure**

Run: `pnpm build && node --test dist/test/cli/quirks-tasks.test.js dist/test/cli/quirks-tasks-mutations.test.js`

Expected: FAIL because mutation commands and `--request-file` are unsupported.

- [ ] **Step 3: Parse and validate bounded mutation request files**

```ts
export async function readMutationRequest(
  repositoryRoot: string,
  requestPath: string,
  expectedOperation: MutationOperation,
): Promise<MutationRequest> {
  const relative = assertRepositoryRelativePosixPath(requestPath);
  const absolute = path.resolve(repositoryRoot, relative);
  if (!absolute.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) {
    throw new CliParseError("request file must remain inside the repository");
  }
  const request = validateSchema<TaskSourceRequest>("task-source-request-v1", JSON.parse(await readFile(absolute, "utf8")));
  if (!("expectedNativeRevision" in request) || request.operation !== expectedOperation) {
    throw new CliParseError(`request operation must be ${expectedOperation}`);
  }
  return request;
}
```

Reject symlink escape, absolute paths, unknown fields, a mismatched operation, and request files over the selected task source's `maxRequestBytes`.

- [ ] **Step 4: Route each mutation through the sync outbox**

```ts
const request = await readMutationRequest(context.root, parsed.requestFile, parsed.command);
const response = await reconcileMutation({
  campaignId: campaignIdFromMutation(request),
  outbox,
  source,
  request,
});
const counts = await syncCounts(outbox);
writeJson(process.stdout, {
  ok: response.ok,
  driver,
  operation: request.operation,
  response,
  pending: counts.pending,
  conflicts: counts.conflicts,
});
```

Exit `3` for schema/conflict failures, `4` for unavailable sources, and never emit diagnostics on JSON stdout.

- [ ] **Step 5: Add source-tree wrappers and package scripts**

```js
#!/usr/bin/env node
import "../dist/src/cli/quirks-tasks.js";
```

Add the equivalent campaign wrapper and package scripts `quirks:tasks` and `quirks:campaign`. Prove `./scripts/quirks-tasks validate --json` works after `pnpm build`; installed packages continue using the existing `bin` entries.

- [ ] **Step 6: Verify and commit**

Run: `pnpm build && node --test dist/test/cli/quirks-tasks.test.js dist/test/cli/quirks-tasks-mutations.test.js dist/test/integration/task-source-kernel.test.js`

Expected: PASS with JSON-only stdout, zero pending sync intents, and semantic propose/claim/review/provenance/complete transitions.

Commit: `feat: expose task mutation CLI`

---

### Task 2: Canonical dogfood tasks and packaged skill references (`QK-DGF-002B`)

**Files:**
- Create transiently: `.quirks/requests/qk-dgf-002*.propose.json` (delete after acknowledged proposals)
- Create transiently: `.quirks/requests/qk-dgf-003.propose.json` (delete after acknowledged proposal)
- Modify: `skills/running-agent-campaigns/SKILL.md`
- Modify: `skills/dispatching-external-agents/SKILL.md`
- Modify: `scripts/validate-skills.mjs`
- Modify: `test/skills/structure.test.ts`
- Create: `test/skills/reference-resolution.test.ts`

**Interfaces:**
- Consumes: Task 1 mutation CLI and root `references/model-routing.md`, `references/runners/*.md`.
- Produces: umbrella task `QK-DGF-002`, executable child tasks `QK-DGF-002A`–`QK-DGF-002G`, discovery task `QK-DGF-003`, and a validator that fails any shipped skill with a missing repository-relative reference.

- [ ] **Step 1: Write the missing-reference regression test**

```ts
test("every local markdown reference in a shipped skill resolves", async () => {
  const report = await validateSkills({ root: path.resolve(".") });
  assert.equal(report.ok, true, report.errors.join("\n"));
  assert.deepEqual(report.skills.flatMap((skill) => skill.errors), []);
});
```

- [ ] **Step 2: Run it and observe the current four missing references**

Run: `pnpm build && node --test dist/test/skills/reference-resolution.test.js`

Expected: FAIL for `running-agent-campaigns/references/model-routing.md` and three `dispatching-external-agents/references/runners/*.md` paths.

- [ ] **Step 3: Make references explicit from each skill directory**

Use `../../references/model-routing.md` and `../../references/runners/{claude,codex,cursor}.md`. Extend `validateSkills` to extract inline-code Markdown paths ending in `.md`, resolve them relative to the containing `SKILL.md`, require a regular file, and require the resolved file to remain inside the package root.

- [ ] **Step 4: Propose the complete dogfood task graph through Task 1**

Create schema-valid proposal request files containing the umbrella, the approved seven-slice decomposition, and the reference-validation discovery. Dependency edges are `002A -> 002B -> 002C -> 002D -> 002E -> 002F -> 002G`; `QK-DGF-002` depends on `QK-DGF-002G`, while `QK-DGF-003` is completed by this task's reference fix. Read the current source state through `quirks-tasks validate`, use unique idempotency keys, then run every proposal in dependency order:

```bash
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002a.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002b.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002c.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002d.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002e.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002f.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-002g.propose.json --json
./scripts/quirks-tasks propose --request-file .quirks/requests/qk-dgf-003.propose.json --json
./scripts/quirks-tasks sync --json
```

Delete the transient request files only after every response is acknowledged and `pending` is zero.

- [ ] **Step 5: Verify and commit**

Run: `pnpm validate:skills && pnpm build && node --test dist/test/skills/structure.test.js dist/test/skills/reference-resolution.test.js`

Expected: PASS and both tasks visible through `./scripts/quirks-tasks show TASK --json`.

Commit: `fix: close dogfood task and skill reference bootstrap`

---

### Task 3: Real profile routing and durable runner/worktree adapters (`QK-DGF-002C`)

**Files:**
- Create: `src/runner/cli-runner-port.ts`
- Create: `src/campaign/runtime-context.ts`
- Modify: `src/campaign/preflight.ts`
- Modify: `src/campaign/supervisor.ts`
- Modify: `src/cli/campaign-commands.ts`
- Modify: `src/runner/claude.ts`
- Modify: `src/runner/codex.ts`
- Modify: `src/runner/cursor.ts`
- Create: `test/runner/cli-runner-port.test.ts`
- Create: `test/campaign/real-runtime-context.test.ts`
- Modify: `test/cli/quirks-campaign.test.ts`

**Interfaces:**
- Consumes: `loadRunnerProfiles()`, `resolveRoute()`, argv builders, `dispatchRunnerJob()`, and `GitWorktreeManager`.
- Produces: `createCampaignRuntime(envelope, repositoryRoot)` with explicit `fake` or `real` mode; real mode cannot construct fake ports.

- [ ] **Step 1: Write failing runtime-boundary tests**

```ts
test("real runtime loads envelope-approved profiles and Git worktrees", async () => {
  const runtime = await createCampaignRuntime(envelope, fixtureRoot, { mode: "real", configDir });
  assert.equal(runtime.runner.constructor.name, "CliRunnerPort");
  assert.equal(runtime.worktree.constructor.name, "GitWorktreeManager");
});

test("real runtime fails closed when user profiles are missing", async () => {
  await assert.rejects(
    () => createCampaignRuntime(envelope, fixtureRoot, { mode: "real", configDir: missing }),
    /Missing user configuration file profiles.json/,
  );
});
```

- [ ] **Step 2: Run focused tests and observe fake-only behavior**

Run: `pnpm build && node --test dist/test/campaign/real-runtime-context.test.js dist/test/cli/quirks-campaign.test.js`

Expected: FAIL because campaign commands always instantiate `FakeCliRunnerPort` and `LocalWorktreePort`.

- [ ] **Step 3: Resolve real routes during preflight**

When `externalRoutingEnabled` is true, load user profiles, resolve an implementer and independent reviewer for every selected non-completed task, and persist exact profile IDs/tier/effort in the envelope. Missing, incompatible, or unhealthy profiles become blockers. Placeholder profiles remain permitted only in explicitly injected fake test mode.

- [ ] **Step 4: Implement the real runner port**

```ts
export class CliRunnerPort implements RunnerPort {
  constructor(private readonly profiles: ReadonlyMap<string, RunnerProfile>) {}

  async dispatch(input: RunnerDispatchInput): Promise<RunnerJobResult> {
    const profile = requiredProfile(this.profiles, input.route.profileId);
    const artifactDir = path.dirname(input.briefPath);
    const argv = buildRunnerArgv(profile, input, artifactDir);
    return dispatchRunnerJob({
      jobId: input.jobId,
      profile,
      argv,
      artifactDir,
      timeoutMs: profile.wallClockMs,
      env: sanitizedRunnerEnv(profile),
    });
  }
}
```

Generate a Claude session UUID before spawn, use Codex's declared result file, use Cursor's structured output mode, and require on-disk evidence for every success.

- [ ] **Step 5: Construct a real Git runtime and preserve fake injection**

Replace `supervisorContext` with `createCampaignRuntime`. Real mode opens `GitWorktreeManager`, verifies the envelope base commit and target branch, and loads profiles from `QUIRKS_CONFIG_DIR`. Tests pass `{ mode: "fake", runner, worktree }`; production never selects fake mode from an unset variable.

- [ ] **Step 6: Claim only actionable tasks and preserve dependencies**

Fetch normalized task metadata before claim. Skip `completed` dependencies, reject `proposed/blocked/cancelled`, claim only `ready`, and build the scheduler with real `dependsOn` and `parallelismKeys`. A worker success records evidence but cannot complete the task.

- [ ] **Step 7: Verify and commit**

Run: `pnpm build && node --test dist/test/runner/cli-runner-port.test.js dist/test/campaign/real-runtime-context.test.js dist/test/campaign/supervisor.test.js dist/test/cli/quirks-campaign.test.js`

Expected: PASS with a fake-runtime suite and a separate real-runtime suite using executable fake CLIs through the actual argv dispatcher.

Commit: `feat: wire real campaign runner runtime`

---

### Task 4: Executable nine-cell host/runner smoke harness (`QK-DGF-002D`)

**Files:**
- Create: `src/smoke/types.ts`
- Create: `src/smoke/evidence.ts`
- Create: `src/smoke/host-runner.ts`
- Create: `scripts/quirks-smoke-host-runner.mjs`
- Modify: `test/smoke/claude-host-runner.test.ts`
- Modify: `test/smoke/codex-host-runner.test.ts`
- Modify: `test/smoke/cursor-host-runner.test.ts`
- Create: `test/smoke/host-runner-harness.test.ts`
- Modify: `docs/smoke/2026-host-matrix.md`

**Interfaces:**
- Consumes: installed host command, target runner profile, Task 3 control plane, disposable fixture repository, and explicit approval environment.
- Produces: one redacted `HostRunnerEvidence` record per matrix cell and a deterministic Markdown projection.

- [ ] **Step 1: Replace approved-path `assert.fail` with a failing harness test**

```ts
test("approved smoke executes a supplied host/runner cell", async () => {
  const evidence = await runHostRunnerCell({
    host: "codex",
    runner: "claude",
    fixtureRoot,
    configDir,
    approved: true,
  });
  assert.equal(evidence.outcome, "passed");
  assert.match(evidence.artifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(evidence.sessionAvailable, true);
});
```

- [ ] **Step 2: Run it and observe the missing harness failure**

Run: `pnpm build && node --test dist/test/smoke/host-runner-harness.test.js`

Expected: FAIL because `runHostRunnerCell` does not exist.

- [ ] **Step 3: Implement bounded evidence and redaction**

```ts
export interface HostRunnerEvidence {
  schemaVersion: 1;
  date: string;
  os: string;
  host: "claude" | "codex" | "cursor";
  hostVersion: string;
  runner: "claude" | "codex" | "cursor";
  runnerVersion: string;
  model: string;
  effort: string;
  profileId: string;
  outcome: "passed" | "failed" | "blocked";
  sessionAvailable: boolean;
  artifactDigest: string;
  deviations: string[];
}
```

Reject credential-shaped strings, absolute home paths, raw stdout/stderr, prompt bodies, and unbounded artifacts from persisted evidence.

- [ ] **Step 4: Drive the actual host integration**

For each host, invoke its installed non-interactive CLI with an argv array and a repository-local prompt file telling the host to call `quirks-campaign preflight`, use the loopback-approved campaign, start it, poll status, and return only the bounded evidence file. The runner is selected solely by the envelope profile. A direct shell dispatch does not count as a host cell.

- [ ] **Step 5: Run all nine approved cells**

Run: `QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes node scripts/quirks-smoke-host-runner.mjs --all --evidence-dir .superpowers/sdd/qk-dgf-002/smoke`

Expected: nine records, each with actual host/runner versions, a session handle classification, deterministic artifact digest, and no credential/home-path scan finding. Allow one transient retry; record usage limits as blocked without tier downgrade.

- [ ] **Step 6: Project dated evidence and commit**

Regenerate `docs/smoke/2026-host-matrix.md` from the bounded records, run the three compiled smoke tests with approval enabled, then run the same tests without approval and confirm only the blocked-path assertions run.

Commit: `test: execute real host runner smoke matrix`

---

### Task 5: Real personal marketplace installation (`QK-DGF-002E`)

**Files:**
- Create: `hosts/codex/install.mjs`
- Create: `hosts/codex/uninstall.mjs`
- Modify: `hosts/claude/install.mjs`
- Modify: `hosts/claude/uninstall.mjs`
- Modify: `hosts/cursor/install.mjs`
- Modify: `hosts/cursor/uninstall.mjs`
- Create: `scripts/quirks-install.mjs`
- Create: `scripts/quirks-uninstall.mjs`
- Modify: `test/smoke/marketplace-install.test.ts`
- Create: `test/host/codex-install.test.ts`
- Modify: `references/hosts/claude.md`
- Modify: `references/hosts/codex.md`
- Modify: `references/hosts/cursor.md`

**Interfaces:**
- Consumes: canonical repository root, explicit host roots, managed-link safety helpers, and marketplace manifest.
- Produces: one idempotent `installAllHosts()`/`uninstallAllHosts()` result with per-host discovery evidence.

- [ ] **Step 1: Write failing actual-install tests**

```ts
test("marketplace install makes all canonical skills discoverable in all hosts", async () => {
  const installed = await installAllHosts({ sourceRoot: repoRoot, roots: sandboxRoots });
  assert.deepEqual(installed.map((entry) => entry.action), ["created", "created", "created"]);
  for (const host of ["claude", "codex", "cursor"] as const) {
    assert.deepEqual(await discoverInstalledSkillIds(host, sandboxRoots[host]), CANONICAL_SKILLS);
  }
});
```

- [ ] **Step 2: Run and observe missing Codex/CLI behavior**

Run: `pnpm build && node --test dist/test/host/codex-install.test.js dist/test/smoke/marketplace-install.test.js`

Expected: FAIL because Codex has no installer and existing host modules do nothing when invoked as CLIs.

- [ ] **Step 3: Add executable, argument-driven installers**

Every host installer exports its current function and, when executed directly, resolves the documented default or explicit `--root`, prints one bounded JSON result, and refuses non-link overwrite. Codex links the canonical plugin root into its reviewed plugin directory; it never copies skills.

- [ ] **Step 4: Install into the actual user host directories**

Run: `QUIRKS_SMOKE_APPROVED=approve-marketplace-install node scripts/quirks-install.mjs --all --source . --json`

Expected: Claude, Codex, and Cursor report `created` or `unchanged`, their host-specific discovery probes find the canonical skills, and the package credential/path scan remains green.

- [ ] **Step 5: Verify idempotency and safe uninstall in a sandbox**

Run installation twice in temporary host roots, uninstall, and prove no foreign file or non-link directory is replaced or removed.

Commit: `feat: install quirks across supported hosts`

---

### Task 6: Bounded private dogfood campaign and exact landing (`QK-DGF-002F`)

**Files:**
- Create: `test/fixtures/real-campaign/.agents/quirks.json`
- Create: `test/fixtures/real-campaign/.quirks/tasks.json`
- Create: `test/fixtures/real-campaign/src/message.txt`
- Create: `scripts/quirks-bounded-campaign.mjs`
- Modify: `docs/smoke/bounded-campaign-report.md`
- Create: `test/smoke/bounded-real-campaign.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5, one approved runner profile, loopback approval, `GitWorktreeManager`, landing/provenance write-back, and an exact private test remote/branch.
- Produces: one accepted commit that changes only `src/message.txt`, one independent review, exact push evidence, and acknowledged task provenance.

- [ ] **Step 1: Write the failing bounded-campaign acceptance test**

```ts
test("bounded campaign cannot land before approval, review, and provenance acknowledgement", async () => {
  const result = await runBoundedCampaign({ fixtureRoot, remote, approved: true });
  assert.equal(result.changedFiles.join("\n"), "src/message.txt");
  assert.equal(result.review.outcome, "approved");
  assert.equal(result.taskStatus, "completed");
  assert.equal(result.remoteHead, result.acceptedCommit);
});
```

- [ ] **Step 2: Run it and observe the missing orchestration failure**

Run: `pnpm build && node --test dist/test/smoke/bounded-real-campaign.test.js`

Expected: FAIL because the real bounded campaign script is absent.

- [ ] **Step 3: Preflight and obtain loopback digest approval**

The script creates a fresh disposable Git repository and bare private test remote, proposes one ready task through `quirks-tasks`, then runs `quirks-campaign preflight --external-routing`. It starts `quirks-campaign ui open`; execution remains blocked until the UI records approval for the exact digest.

- [ ] **Step 4: Execute, review, land, and write provenance**

Dispatch one real implementer to replace the fixture message with the exact approved string, dispatch a cross-vendor reviewer, verify the single-file diff, merge through the landing port, attach compact provenance, complete after sync acknowledgement, and push only the envelope's exact remote/branch.

- [ ] **Step 5: Run the approved campaign**

Run: `QUIRKS_SMOKE_APPROVED=approve-exact-campaign node scripts/quirks-bounded-campaign.mjs --profile PROFILE_ID --remote PRIVATE_TEST_REMOTE --branch quirks-smoke --json`

Expected: one campaign ID, one implementation session, one independent review session, one accepted commit, zero pending sync intents, and exact remote HEAD equality.

- [ ] **Step 6: Persist only redacted evidence and commit**

Replace the blocked report with date, campaign ID, task ID, sanitized profile/model classes, commit, changed path, verification, review outcome, provenance acknowledgement, and remote target summary. Persist no prompts, stdout, credentials, local home paths, or remote credential material.

Commit: `test: complete bounded real quirks campaign`

---

### Task 7: Canonical truth reconciliation and final release review (`QK-DGF-002G`)

**Files:**
- Create: `.quirks/requests/` transient mutation requests (delete after acknowledgement)
- Modify through CLI only: `.quirks/tasks.json`
- Modify: `.superpowers/sdd/overnight-2026-07-21/FINAL-CAMPAIGN-REPORT.md`
- Create: `.superpowers/sdd/qk-dgf-002/final-review.md`
- Modify: `docs/smoke/2026-host-matrix.md`
- Modify: `docs/smoke/bounded-campaign-report.md`

**Interfaces:**
- Consumes: exact accepted commits, fresh test output, nine smoke records, marketplace discovery, bounded-campaign evidence, and current task native revisions.
- Produces: canonical parent/child status parity, acknowledged provenance, a non-self-referential final report, and a reviewed release commit.

- [ ] **Step 1: Write a reconciliation audit that fails on current truth drift**

```ts
test("completed release tasks have passing external evidence", async () => {
  const audit = await auditTaskTruth({ repositoryRoot: path.resolve(".") });
  assert.deepEqual(audit.errors, []);
});
```

The audit rejects completed tasks whose report says blocked, accepted commits not reachable from the target branch, aggregate parents left proposed after all children pass, and `pending_sync` greater than zero.

- [ ] **Step 2: Run it and capture every stale aggregate or false completion**

Run: `pnpm build && node --test dist/test/integration/task-truth-reconciliation.test.js`

Expected before reconciliation: FAIL for the Wave 7 false-completion records and stale aggregate parents.

- [ ] **Step 3: Reconcile exclusively through mutation commands**

Refresh with `quirks-tasks sync`, show each task to capture its native revision, then use `block`, `release`, `submit-review`, `attach-provenance`, and `complete` requests as appropriate. Never rewrite a provenance iteration; append a corrective iteration that names the superseded false-completion evidence.

- [ ] **Step 4: Fix the final report's commit semantics**

Replace `Final main tip` with `Release candidate commit` so committing the report does not immediately make its own SHA stale. The report must distinguish implementation gates, actual external gates, local branch, pushed remote, remaining post-v1 adapter work, and every dogfood discovery.

- [ ] **Step 5: Run complete verification**

Run: `pnpm check`

Run: `pnpm exec playwright test`

Run: `node --test dist/test/smoke/*.test.js` once without approval to prove fail-closed behavior and the approved harness separately with the bounded evidence fixtures.

Expected: all mandatory tests pass; only explicitly credential-dependent probes may be classified blocked, and no task representing them may be completed.

- [ ] **Step 6: Independent release review and landing**

Review the complete branch against design sections 16.1, 23.5, 23.6, and 24. Verify credential scans, Git target/push evidence, matrix completeness, marketplace discovery, bounded campaign evidence, task/provenance parity, and zero pending sync. Commit review fixes, merge the reviewed branch to local `main`, rerun `pnpm check`, and push only the exact approved `main` SHA.

Commit: `chore: reconcile dogfood release truth`

## Plan Boundary Verification

- [ ] Every `QK-DGF-002A`–`002G` task is authored through the repaired TaskSource CLI and has exact dependency edges.
- [ ] No shipped skill reference resolves outside the plugin package or to a missing file.
- [ ] No production campaign code constructs `FakeCliRunnerPort`, `LocalWorktreePort`, or placeholder routes without explicit fake test injection.
- [ ] All nine host/runner cells originate from their actual installed host integration.
- [ ] Marketplace evidence proves installation and discovery, not manifest parsing alone.
- [ ] The bounded campaign proves loopback approval, real runner execution, independent review, exact Git landing, provenance acknowledgement, and exact push.
- [ ] Canonical task status, Git ancestry, external evidence, and reports agree.
- [ ] `pnpm check`, Playwright, credential scans, and final independent review pass on the exact release candidate.
