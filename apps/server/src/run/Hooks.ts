// Default parent hooks for the service — real argv + dispatchRunner.
// Models and efforts come from the QK-HARN tier table (harness/Tiers.ts); the
// reviewer is chosen for model-family independence, not just a different string,
// so "the parent never reviews its own task's work" is checkable.
// Ported from the bun-era src/run/hooks.ts (QK-MONO-005).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { buildClaudeArgv, mintSessionId } from "../runner/Claude.ts";
import { buildCodexArgv, codexPromptText } from "../runner/Codex.ts";
import { buildCursorArgv } from "../runner/Cursor.ts";
import { dispatchRunner } from "../runner/Dispatch.ts";
import type { DispatchOutcome, RunnerKind } from "../runner/Types.ts";
import { resolveTier, selectIndependentReviewer, type JudgmentTier } from "../harness/Tiers.ts";
import { invalid, type ValidationError } from "../ops/Errors.ts";
import type { ParentDispatchRequest, ParentHooks } from "./Parent.ts";

/** The implementer tier a run uses when the task says nothing. */
const DEFAULT_TIER: JudgmentTier = "standard";
const DEFAULT_RUNNER: RunnerKind = "claude";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface RoleRouting {
  readonly runner: RunnerKind;
  readonly model: string;
  readonly effort: string;
}

export interface DefaultRouting {
  readonly implementer: RoleRouting;
  readonly reviewer?: RoleRouting | undefined;
  readonly reviewNote: string;
}

/** Tier table → implementer, plus an independent reviewer or none at all. */
export const defaultRouting = (
  tier: JudgmentTier = DEFAULT_TIER,
  available: readonly RunnerKind[] = [DEFAULT_RUNNER],
): Effect.Effect<DefaultRouting, ValidationError> =>
  Effect.gen(function* () {
    // An empty set means nothing is installed. Refuse here with something readable
    // rather than dispatching into a spawn error thirty minutes into the night.
    const runner = available[0];
    if (runner === undefined) {
      return yield* invalid(
        "no harness is installed — quirks harness shows what was looked for and where",
      );
    }
    const resolved = resolveTier(runner, tier);
    if (resolved.model === null) {
      return yield* invalid(
        `no probed model for ${runner} at tier ${tier} — quirks harness shows the table`,
      );
    }
    const implementer: RoleRouting = {
      runner,
      model: resolved.model,
      effort: resolved.effort ?? tier,
    };

    const selection = selectIndependentReviewer({
      implementer: { runner, model: resolved.model, tier },
      available,
    });
    if (selection.kind !== "independent") {
      // Never silently review with the implementer's own model. Run without a
      // reviewer and hand back the reason; `quirks harness` shows the same
      // per-tier verdict in its review table, so this is not the only place it
      // surfaces.
      return { implementer, reviewNote: selection.reason };
    }
    const rev = resolveTier(selection.reviewer.runner, selection.reviewer.tier);
    return {
      implementer,
      reviewer: {
        runner: selection.reviewer.runner,
        model: selection.reviewer.model,
        effort: rev.effort ?? selection.reviewer.tier,
      },
      reviewNote: selection.reason,
    };
  });

function gitHead(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function buildArgv(
  req: ParentDispatchRequest,
  sessionId: string,
  effort: string,
): readonly string[] {
  if (req.runner === "claude") {
    return buildClaudeArgv({
      executable: "claude",
      sessionId,
      model: req.model,
      effort,
      briefPath: req.briefPath,
      workspace: req.worktree,
      artifactDir: req.artifactDir,
    });
  }
  if (req.runner === "codex") {
    let contents: string | undefined;
    try {
      contents = readFileSync(req.briefPath, "utf8");
    } catch {
      contents = undefined;
    }
    return buildCodexArgv({
      executable: "codex",
      model: req.model,
      workspace: req.worktree,
      artifactDir: req.artifactDir,
      effort,
      promptText: codexPromptText(req.briefPath, contents),
    });
  }
  return buildCursorArgv({
    executable: "cursor-agent",
    model: req.model,
    briefPath: req.briefPath,
    workspace: req.worktree,
    artifactDir: req.artifactDir,
  });
}

export interface DefaultHooksOptions {
  readonly implementer?: { readonly runner: RunnerKind; readonly model: string } | undefined;
  readonly reviewer?: { readonly runner: RunnerKind; readonly model: string } | undefined;
  readonly review?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  /** Implementer tier; the reviewer is derived one tier above it. */
  readonly tier?: JudgmentTier | undefined;
  readonly available?: readonly RunnerKind[] | undefined;
}

/**
 * Build the hooks a real run dispatches with. The spawner's context is captured
 * here, once, so `ParentHooks.dispatch` hands the parent loop an
 * `Effect<DispatchOutcome>` that needs nothing — the parent cannot reach a
 * process except through a hook somebody handed it.
 */
export const defaultParentHooks = (
  opts: DefaultHooksOptions = {},
): Effect.Effect<ParentHooks, ValidationError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const routing = yield* defaultRouting(opts.tier, opts.available);
    const spawner = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

    const implementer = opts.implementer ?? {
      runner: routing.implementer.runner,
      model: routing.implementer.model,
    };
    const reviewer =
      opts.reviewer ??
      (routing.reviewer
        ? { runner: routing.reviewer.runner, model: routing.reviewer.model }
        : undefined);

    // Effort follows the resolved tier per role. An explicitly overridden model
    // keeps its role's effort — the caller chose the model, not a new tier.
    const effortFor = (role: ParentDispatchRequest["role"]): string =>
      role === "reviewer"
        ? (routing.reviewer?.effort ?? routing.implementer.effort)
        : routing.implementer.effort;

    return {
      implementer,
      ...(reviewer ? { reviewer } : {}),
      review: opts.review ?? reviewer !== undefined,
      detectLandingCommit: (worktree, base) => {
        const head = gitHead(worktree);
        if (!head || !base || head === base) return null;
        return head;
      },
      dispatch: (req) =>
        Effect.gen(function* () {
          const jobId = `${req.role}-${req.taskId}-${Date.now()}`;
          // The session id is NOT the job id — see runner/Claude.ts for the
          // refusal the bun-era code earned on every claude dispatch. The job id
          // keeps naming the transcript; the session gets a real UUID.
          const argv = buildArgv(req, mintSessionId(), effortFor(req.role));
          const result = yield* dispatchRunner({
            jobId,
            runner: req.runner,
            argv,
            artifactDir: req.artifactDir,
            timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            cwd: req.worktree,
          });
          const path = result.transcriptPath;
          if (path === null) return result satisfies DispatchOutcome;
          const transcript = yield* Effect.sync(() => {
            try {
              return readFileSync(path, "utf8");
            } catch {
              return undefined;
            }
          });
          return (
            transcript !== undefined ? { ...result, transcript } : { ...result }
          ) satisfies DispatchOutcome;
        }).pipe(Effect.provideContext(spawner)),
    } satisfies ParentHooks;
  });
