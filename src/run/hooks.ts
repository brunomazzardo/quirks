// Default parent hooks for the daemon — real argv + dispatchRunner.
// Models come from the run plan once QK-HARN lands; until then defaults.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildClaudeArgv } from "../runner/claude.ts";
import { buildCodexArgv, codexPromptText } from "../runner/codex.ts";
import { buildCursorArgv } from "../runner/cursor.ts";
import { dispatchRunner } from "../runner/dispatch.ts";
import type { RunnerKind } from "../runner/types.ts";
import type { ParentHooks, ParentDispatchRequest } from "./parent.ts";

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

function buildArgv(req: ParentDispatchRequest, sessionId: string): readonly string[] {
  if (req.runner === "claude") {
    return buildClaudeArgv({
      executable: "claude",
      sessionId,
      model: req.model,
      effort: "standard",
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
      effort: "standard",
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
}): ParentHooks {
  const implementer = opts?.implementer ?? { runner: "claude" as const, model: "sonnet" };
  const reviewer = opts?.reviewer ?? { runner: "claude" as const, model: "opus" };
  return {
    implementer,
    reviewer,
    review: opts?.review ?? true,
    detectLandingCommit: (worktree, base) => {
      const head = gitHead(worktree);
      if (!head || !base || head === base) return null;
      return head;
    },
    dispatch: async (req) => {
      const jobId = `${req.role}-${req.taskId}-${Date.now()}`;
      const argv = buildArgv(req, jobId);
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
