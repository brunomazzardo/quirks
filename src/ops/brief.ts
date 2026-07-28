// The brief: CLI assembles facts. Skills supply judgment. Only honesty
// properties get code — and the pin→HEAD diff is the one that makes "this
// changed" computable at all (never written-and-unread).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { goalIdOfTask } from "../store/ids.ts";
import { loadGoals, type Store } from "../store/store.ts";
import type { Goal, SourceRef, Task } from "../store/types.ts";

export interface SourceFact {
  path: string;
  pinnedCommit: string | null;
  /** HEAD at assembly time — the other end of the pin comparison. */
  headCommit: string | null;
  /** True when the file's content at pin differs from content at HEAD. */
  changed: boolean;
  /** `git diff pin..HEAD -- path`, empty string when unchanged, null when incomparable. */
  diff: string | null;
  /** ISO author/committer date of the last change to the path at the pin (or null). */
  pinnedLastChanged: string | null;
  headLastChanged: string | null;
}

export interface TaskBrief {
  task: {
    id: string;
    title: string;
    goal: string | null;
    deliverables: string[];
    acceptanceCriteria: string[];
    verification: string[];
    dependsOn: string[];
    effort?: string;
    risk?: string;
    revision: number;
  };
  goal: {
    id: string;
    title: string;
    why: Goal["why"];
    doneWhen: string[];
  } | null;
  sources: SourceFact[];
  git: {
    baseCommit: string | null;
    candidateCommit: string | null;
    worktree: string | null;
  };
  operatorNotes: string;
  /** sha256:… of the instruction files the agent would hold at this moment. */
  instructionsHash: string;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
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
  operatorNotes?: string;
  /** Candidate commit once work exists; null for a pre-dispatch brief. */
  candidateCommit?: string | null;
  /** Worktree path once dispatch creates one; null until then. */
  worktree?: string | null;
}

export function assembleBrief(store: Store, task: Task, opts: AssembleBriefOptions = {}): TaskBrief {
  const gid = goalIdOfTask(task.id);
  const goal = gid ? (loadGoals(store).find((g) => g.id === gid) ?? null) : null;
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
  };
}
