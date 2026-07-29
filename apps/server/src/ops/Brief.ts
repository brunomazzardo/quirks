// The brief: CLI assembles facts. Skills supply judgment (D17). Only honesty
// properties get code — and the pin→HEAD diff is the one that makes "this
// changed" computable at all (never written-and-unread).
// Ported from the bun-era src/ops/brief.ts (QK-MONO-005).
//
// The S11 reshaping into a rendered Markdown brief is QK-SKILL work and is
// deliberately NOT anticipated here: this ports current behaviour, so the day
// the reshape lands there is one behaviour to move, not two.
//
// git is read through execFileSync, the precedent QK-MONO-003 set for
// `rev-parse` in store/Store.ts. These are short, bounded, read-only reads whose
// only failure mode is "no answer" — the platform Command API buys nothing here
// that it buys for dispatch (process groups, timeouts, retained transcripts).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { SourceFact, SourceRef, Task, TaskBrief } from "@quirks/contracts";
import { REVIEW_INSTRUCTIONS } from "../runner/Verdict.ts";
import { goalIdOfTask } from "../store/Ids.ts";
import { Ledger, Store } from "../store/Store.ts";
import type { StoreError } from "../store/JsonFile.ts";

// SourceFact and TaskBrief live in @quirks/contracts (they cross the wire in
// dry-run responses); re-exported here for the server-internal consumers.
export type { SourceFact, TaskBrief } from "@quirks/contracts";

function git(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return null;
  }
}

export function headCommit(root: string): string | null {
  return git(root, ["rev-parse", "HEAD"]);
}

/** Last commit date that touched `path` at (or before) `commit`. */
function lastChanged(root: string, commit: string, path: string): string | null {
  const out = git(root, ["log", "-1", "--format=%cI", commit, "--", path]);
  return out && out.length > 0 ? out : null;
}

/** Compare one sourceRef's pin against HEAD. Absence of a pin is honest nulls,
 *  never a fabricated "unchanged". */
export function sourceFact(root: string, ref: SourceRef, head: string | null): SourceFact {
  const pinned = ref.pinnedCommit;
  if (!pinned || !head) {
    return {
      path: ref.path,
      pinnedCommit: pinned,
      headCommit: head,
      changed: false,
      diff: null,
      pinnedLastChanged: pinned ? lastChanged(root, pinned, ref.path) : null,
      headLastChanged: head ? lastChanged(root, head, ref.path) : null,
    };
  }
  const diff = git(root, ["diff", `${pinned}..${head}`, "--", ref.path]);
  // git diff returns "" when unchanged; null only when git itself failed (handled above).
  const text = diff ?? "";
  return {
    path: ref.path,
    pinnedCommit: pinned,
    headCommit: head,
    changed: text.length > 0,
    diff: text,
    pinnedLastChanged: lastChanged(root, pinned, ref.path),
    headLastChanged: lastChanged(root, head, ref.path),
  };
}

/** Stable hash of the instruction surface an agent would read. Files that do
 *  not exist are omitted (not hashed as empty) so absence is visible as a
 *  shorter set, never as a silent zero-byte blob. */
export function computeInstructionsHash(root: string): string {
  const entries: Array<{ path: string; body: string }> = [];
  for (const path of ["CLAUDE.md", "AGENTS.md"]) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    entries.push({ path, body: readFileSync(abs, "utf8") });
  }
  const skillsRoot = join(root, ".claude", "skills");
  if (existsSync(skillsRoot)) {
    for (const name of readdirSync(skillsRoot).sort()) {
      const path = `.claude/skills/${name}/SKILL.md`;
      const abs = join(root, path);
      if (!existsSync(abs)) continue;
      entries.push({ path, body: readFileSync(abs, "utf8") });
    }
  }
  const h = createHash("sha256");
  for (const e of entries) {
    h.update(e.path);
    h.update("\0");
    h.update(e.body);
    h.update("\0");
  }
  return `sha256:${h.digest("hex")}`;
}

export interface AssembleBriefOptions {
  /** Per-task notes from the run planner — empty string when none. */
  readonly operatorNotes?: string | undefined;
  /** Candidate commit once work exists; null for a pre-dispatch brief. */
  readonly candidateCommit?: string | null | undefined;
  /** Worktree path once dispatch creates one; null until then. */
  readonly worktree?: string | null | undefined;
}

/**
 * The section that turns an implementer's brief into a REVIEWER's.
 *
 * A function, not a shared constant: each brief owns its own arrays, so nothing
 * downstream can mutate the instructions every later brief would carry. The
 * parent spreads this onto the brief it already assembled rather than paying for
 * a second assembly — see run/Parent.ts.
 */
export const reviewerBriefSection = (): NonNullable<TaskBrief["review"]> => ({
  role: "reviewer",
  instructions: [...REVIEW_INSTRUCTIONS],
});

export const assembleBrief = (
  task: Task,
  opts: AssembleBriefOptions = {},
): Effect.Effect<TaskBrief, StoreError, Ledger | Store> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const store = yield* Store;
    const gid = goalIdOfTask(task.id);
    const goal = gid ? ((yield* ledger.loadGoals).find((g) => g.id === gid) ?? null) : null;
    const head = headCommit(store.root);
    return {
      task: {
        id: task.id,
        title: task.title,
        goal: gid,
        deliverables: task.deliverables,
        acceptanceCriteria: task.acceptanceCriteria,
        verification: task.verification,
        dependsOn: task.dependsOn,
        ...(task.effort !== undefined ? { effort: task.effort } : {}),
        ...(task.risk !== undefined ? { risk: task.risk } : {}),
        revision: task.revision,
      },
      goal: goal
        ? { id: goal.id, title: goal.title, why: goal.why, doneWhen: goal.doneWhen }
        : null,
      sources: task.sourceRefs.map((ref) => sourceFact(store.root, ref, head)),
      git: {
        baseCommit: head,
        candidateCommit: opts.candidateCommit ?? null,
        worktree: opts.worktree ?? null,
      },
      operatorNotes: opts.operatorNotes ?? "",
      instructionsHash: computeInstructionsHash(store.root),
    } satisfies TaskBrief;
  });
