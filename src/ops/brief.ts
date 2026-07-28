// The brief: CLI assembles facts. QK-RUN-001 ships the skeleton so --dry-run
// has something to print; QK-RUN-002 fills pin→HEAD diffs, git base/candidate,
// operator notes, and the instructions hash.

import { goalIdOfTask } from "../store/ids.ts";
import { loadGoals, type Store } from "../store/store.ts";
import type { Goal, Task } from "../store/types.ts";

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
  /** Pin baseline only for now — QK-RUN-002 adds HEAD, the diff, and dates. */
  sources: Task["sourceRefs"];
  git: {
    baseCommit: string | null;
    candidateCommit: string | null;
    worktree: string | null;
  };
  operatorNotes: string;
  instructionsHash: string | null;
}

export function assembleBrief(store: Store, task: Task): TaskBrief {
  const gid = goalIdOfTask(task.id);
  const goal = gid ? (loadGoals(store).find((g) => g.id === gid) ?? null) : null;
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
    sources: task.sourceRefs,
    git: { baseCommit: null, candidateCommit: null, worktree: null },
    operatorNotes: "",
    instructionsHash: null,
  };
}
