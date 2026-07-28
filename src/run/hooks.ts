// Default parent hooks for the daemon — real argv + dispatchRunner.
// Models and efforts come from the QK-HARN tier table (src/harness/tiers.ts);
// the reviewer is chosen for model-family independence, not just a different
// string, so "the parent never reviews its own task's work" is checkable.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildClaudeArgv } from "../runner/claude.ts";
import { buildCodexArgv, codexPromptText } from "../runner/codex.ts";
import { buildCursorArgv } from "../runner/cursor.ts";
import { dispatchRunner } from "../runner/dispatch.ts";
import type { RunnerKind } from "../runner/types.ts";
import {
  resolveTier,
  selectIndependentReviewer,
  type JudgmentTier,
} from "../harness/tiers.ts";
import { ValidationError } from "../ops/errors.ts";
import type { ParentHooks, ParentDispatchRequest } from "./parent.ts";

/** The implementer tier a run uses when the task says nothing. */
const DEFAULT_TIER: JudgmentTier = "standard";
const DEFAULT_RUNNER: RunnerKind = "claude";

interface RoleRouting {
  runner: RunnerKind;
  model: string;
  effort: string;
}

/** Tier table → implementer, plus an independent reviewer or none at all. */
export function defaultRouting(
  tier: JudgmentTier = DEFAULT_TIER,
  available: readonly RunnerKind[] = [DEFAULT_RUNNER],
): { implementer: RoleRouting; reviewer?: RoleRouting; reviewNote: string } {
  // An empty set means nothing is installed. Refuse here with something readable
  // rather than dispatching into a spawn error thirty minutes into the night.
  const runner = available[0];
  if (runner === undefined) {
    throw new ValidationError(
      "no harness is installed — quirks harness shows what was looked for and where",
    );
  }
  const resolved = resolveTier(runner, tier);
  if (resolved.model === null) {
    throw new ValidationError(
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
}

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

export function defaultParentHooks(opts?: {
  implementer?: { runner: RunnerKind; model: string };
  reviewer?: { runner: RunnerKind; model: string };
  review?: boolean;
  timeoutMs?: number;
  /** Implementer tier; the reviewer is derived one tier above it. */
  tier?: JudgmentTier;
  available?: readonly RunnerKind[];
}): ParentHooks {
  const routing = defaultRouting(opts?.tier, opts?.available);
  const implementer = opts?.implementer ?? {
    runner: routing.implementer.runner,
    model: routing.implementer.model,
  };
  const reviewer =
    opts?.reviewer ??
    (routing.reviewer
      ? { runner: routing.reviewer.runner, model: routing.reviewer.model }
      : undefined);

  // Effort follows the resolved tier per role. An explicitly overridden model
  // keeps its role's effort — the caller chose the model, not a new tier.
  const effortFor = (role: ParentDispatchRequest["role"]): string =>
    role === "reviewer"
      ? routing.reviewer?.effort ?? routing.implementer.effort
      : routing.implementer.effort;

  return {
    implementer,
    ...(reviewer ? { reviewer } : {}),
    review: opts?.review ?? reviewer !== undefined,
    detectLandingCommit: (worktree, base) => {
      const head = gitHead(worktree);
      if (!head || !base || head === base) return null;
      return head;
    },
    dispatch: async (req) => {
      const jobId = `${req.role}-${req.taskId}-${Date.now()}`;
      const argv = buildArgv(req, jobId, effortFor(req.role));
      const result = await dispatchRunner({
        jobId,
        runner: req.runner,
        argv,
        artifactDir: req.artifactDir,
        timeoutMs: opts?.timeoutMs ?? 30 * 60 * 1000,
        cwd: req.worktree,
      });
      let transcript: string | undefined;
      if (result.transcriptPath) {
        try {
          transcript = readFileSync(result.transcriptPath, "utf8");
        } catch {
          transcript = undefined;
        }
      }
      return transcript !== undefined ? { ...result, transcript } : { ...result };
    },
  };
}
