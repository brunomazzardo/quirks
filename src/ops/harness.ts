// `quirks harness` — the two D7 views over state the system already computes:
// availability (is each harness present, usable, answering) and the tier/model
// table (what an overnight run will actually dispatch to).
//
// Liveness comes from the run record, not a live round trip. `--probe` is the
// explicit opt-in when the operator wants a real `--version` before an overnight
// run. See src/harness/liveness.ts for why.

import { loadRuns, type Store } from "../store/store.ts";
import type { Task } from "../store/types.ts";
import type { RunnerKind } from "../runner/types.ts";
import {
  deriveLiveness,
  describeLiveness,
  type LivenessState,
  type RunnerLiveness,
} from "../harness/liveness.ts";
import {
  presenceProbes,
  probeRunners,
  type AuthProbe,
  type Presence,
  type RunnerProbe,
  type VersionProbe,
} from "../harness/probe.ts";
import {
  requiredTierForRole,
  resolveTier,
  selectIndependentReviewer,
  tierForEffort,
  tierTable,
  TIERS,
  type JudgmentTier,
  type ReviewerSelection,
  type TierRow,
} from "../harness/tiers.ts";

/** Can a run lean on this harness tonight? Three answers, because two would lie:
 *  a harness nobody has dispatched is not "yes", and it is not "no" either. */
export type Leanable = "yes" | "no" | "unproven";

export interface HarnessRow {
  runner: RunnerKind;
  executable: string;
  presence: Presence["state"];
  presenceDetail: string;
  /** Null unless --probe ran and the binary answered. */
  version: string | null;
  versionDetail: string;
  liveness: LivenessState;
  livenessDetail: string;
  /** From the runner's own status command; "not-probed" without --probe. */
  authorized: AuthProbe["state"];
  authDetail: string;
  lean: Leanable;
  leanDetail: string;
  /**
   * May a run be *routed* here? Presence-based, deliberately ignoring a past
   * dispatch failure — see `routableFrom` for why these two differ.
   */
  routable: boolean;
}

export interface ReviewRow {
  /** Implementer tier this row answers for. */
  tier: JudgmentTier;
  requiredTier: JudgmentTier;
  selection: ReviewerSelection;
}

export interface HarnessView {
  generatedAt: string;
  /** True when --probe ran `--version` against each present harness. */
  probed: boolean;
  harnesses: HarnessRow[];
  tiers: TierRow[];
  /** Independent-review availability, assuming a claude implementer. */
  review: ReviewRow[];
  /** Runners a run may lean on right now, best first — the operator's answer. */
  available: RunnerKind[];
  /** Runners a run would actually route to. Presence-based; see `routableFrom`. */
  routable: RunnerKind[];
}

function presenceDetail(presence: Presence): string {
  switch (presence.state) {
    case "present":
      return presence.executable;
    case "absent":
      return presence.reason;
    case "denied":
      return `${presence.executable}: ${presence.reason}`;
  }
}

function versionOf(probe: VersionProbe): string | null {
  return probe.state === "ok" ? probe.version : null;
}

function versionDetail(probe: VersionProbe): string {
  return probe.state === "ok" ? probe.version : probe.reason;
}

/**
 * Combine the three facts into one answer. Order matters: a harness that is not
 * on disk cannot be leaned on regardless of what the run record remembers, and a
 * permission failure is its own verdict — never folded into "absent".
 */
export function decideLean(
  probe: RunnerProbe,
  liveness: RunnerLiveness,
): { lean: Leanable; detail: string } {
  if (probe.presence.state === "absent") {
    return { lean: "no", detail: probe.presence.reason };
  }
  if (probe.presence.state === "denied") {
    return {
      lean: "no",
      detail: `${probe.presence.reason} — a permission failure is not absence, but it is not usable either`,
    };
  }
  if (probe.version.state === "error" || probe.version.state === "spawn-failed") {
    return { lean: "no", detail: probe.version.reason };
  }
  if (probe.version.state === "timeout") {
    return { lean: "unproven", detail: probe.version.reason };
  }
  // A free auth check may only DEMOTE. Its positive answer is weaker evidence
  // than a dispatch that actually worked, so it never promotes to "yes"; but a
  // runner that says it is logged out cannot be leaned on, and before this the
  // whole class read "unproven" forever (QK-HARN-003).
  if (probe.auth.state === "unauthorized") {
    return { lean: "no", detail: probe.auth.detail };
  }
  switch (liveness.state) {
    case "answered":
      return { lean: "yes", detail: describeLiveness(liveness) };
    case "failed":
      return { lean: "no", detail: describeLiveness(liveness) };
    case "timed-out":
      return { lean: "unproven", detail: describeLiveness(liveness) };
    case "never-dispatched":
      return {
        lean: "unproven",
        detail:
          probe.auth.state === "authorized"
            ? "authenticated, but no run has dispatched to it yet"
            : "installed, but no run has dispatched to it yet",
      };
  }
}

/**
 * Can a run be *routed* here? Presence only, in the fixed preference order
 * claude → codex → cursor.
 *
 * This deliberately differs from `lean`: a recorded dispatch failure does NOT
 * remove a harness from routing. We cannot yet attribute a failure — our own
 * argv bugs exit non-zero exactly like a vendor quota refusal (FOUNDING.md:250
 * has two such bugs from v1), so blocking on one would be acting on a fact we
 * do not have. The operator sees the failure as a plan warning and decides at
 * the `[y/N]`. Absence, by contrast, is a fact about right now, and does block.
 *
 * Order is fixed rather than "best first" so that approving a plan twice yields
 * the same plan — routing must not flip because a dispatch landed in between.
 */
export function routableFrom(rows: readonly HarnessRow[]): RunnerKind[] {
  const order: readonly RunnerKind[] = ["claude", "codex", "cursor"];
  return order.filter((runner) => rows.find((r) => r.runner === runner)?.routable === true);
}

/** Runners the operator may lean on, proven-good first. A "no" is never offered. */
function leanableFrom(rows: readonly HarnessRow[]): RunnerKind[] {
  return [
    ...rows.filter((r) => r.lean === "yes").map((r) => r.runner),
    ...rows.filter((r) => r.lean === "unproven").map((r) => r.runner),
  ];
}

function assembleRows(
  probes: readonly RunnerProbe[],
  store: Store,
  now: Date,
): HarnessRow[] {
  const livenessByRunner = new Map(deriveLiveness(loadRuns(store)).map((l) => [l.runner, l]));
  return probes.map((probe) => {
    const live = livenessByRunner.get(probe.runner)!;
    const { lean, detail } = decideLean(probe, live);
    return {
      runner: probe.runner,
      executable: probe.candidate,
      presence: probe.presence.state,
      presenceDetail: presenceDetail(probe.presence),
      version: versionOf(probe.version),
      versionDetail: versionDetail(probe.version),
      liveness: live.state,
      livenessDetail: describeLiveness(live, now),
      authorized: probe.auth.state,
      authDetail: probe.auth.state === "not-probed" ? probe.auth.reason : probe.auth.detail,
      lean,
      leanDetail: detail,
      // A version probe that errored, or an explicit "logged out", means the
      // binary will not answer now — present-tense facts, unlike liveness, so
      // they do block routing.
      //
      // Caveat worth knowing: `availability()` is synchronous and spawns nothing,
      // so on the plan-assembly path `auth` is always "not-probed" and this term
      // cannot fire. A plan can therefore still route to a logged-out harness;
      // `quirks harness --probe` is where that surfaces.
      routable:
        probe.presence.state === "present" &&
        probe.version.state !== "error" &&
        probe.version.state !== "spawn-failed" &&
        probe.auth.state !== "unauthorized",
    };
  });
}

/** Review independence per tier, resolved over whatever set a run would route to. */
function reviewRows(routable: readonly RunnerKind[]): ReviewRow[] {
  return TIERS.map((tier) => {
    const model = resolveTier("claude", tier).model;
    const requiredTier = requiredTierForRole("reviewer", tier);
    if (model === null) {
      return {
        tier,
        requiredTier,
        selection: {
          kind: "independence-unavailable" as const,
          requiredTier,
          reason: `no probed claude model at tier ${tier} — nothing to review against`,
        },
      };
    }
    return {
      tier,
      requiredTier,
      // Resolved over `routable`, not `available`, so the table shows what a run
      // would actually do rather than a stricter hypothetical.
      selection: selectIndependentReviewer({
        implementer: { runner: "claude", model, tier },
        available: routable,
      }),
    };
  });
}

export interface AvailabilityOptions {
  executables?: Partial<Record<RunnerKind, string>>;
  now?: Date;
}

export interface Availability {
  rows: HarnessRow[];
  /** Where a run may be routed. Presence-based; see `routableFrom`. */
  routable: RunnerKind[];
}

/**
 * Synchronous availability — presence plus the run record, no process spawned.
 * This is what the run path consults during plan assembly (QK-HARN-002).
 */
export function availability(store: Store, opts: AvailabilityOptions = {}): Availability {
  const rows = assembleRows(
    presenceProbes(opts.executables !== undefined ? { executables: opts.executables } : {}),
    store,
    opts.now ?? new Date(),
  );
  return { rows, routable: routableFrom(rows) };
}

export interface HarnessOptions {
  probe?: boolean;
  timeoutMs?: number;
  executables?: Partial<Record<RunnerKind, string>>;
  /** Injectable for tests — defaults to the real clock. */
  now?: Date;
}

export async function harnessView(store: Store, opts: HarnessOptions = {}): Promise<HarnessView> {
  const now = opts.now ?? new Date();
  const probes = await probeRunners({
    probeVersions: opts.probe === true,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.executables !== undefined ? { executables: opts.executables } : {}),
  });
  const harnesses = assembleRows(probes, store, now);
  const routable = routableFrom(harnesses);

  return {
    generatedAt: now.toISOString(),
    probed: opts.probe === true,
    harnesses,
    tiers: tierTable(),
    review: reviewRows(routable),
    available: leanableFrom(harnesses),
    routable,
  };
}

export interface TaskRouting {
  harness: RunnerKind | "unassigned";
  model: string;
  tier: JudgmentTier;
}

/**
 * What a plan row should say for a task. Picks the first available harness that
 * has a probed model at the task's tier; `unassigned` when none does, so the
 * plan keeps admitting ignorance instead of inventing a route.
 */
export function routeTask(task: Task, available: readonly RunnerKind[]): TaskRouting {
  const tier = tierForEffort(task.effort);
  for (const runner of available) {
    const { model } = resolveTier(runner, tier);
    if (model !== null) return { harness: runner, model, tier };
  }
  return { harness: "unassigned", model: "unassigned", tier };
}
