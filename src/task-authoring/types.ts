import type { TaskSource } from "../task-source/task-source.js";

/** Compact immutable reference to a committed repository artifact. */
export interface SourceRef {
  kind: "spec" | "plan" | "review" | "other";
  path: string;
  commit: string;
  task?: number;
  section?: string;
  sections?: readonly number[];
  url?: string;
}

/** Immutable plan mapping for one proposal: which numbered plan tasks the queue task owns. */
export interface PlannedTaskRef {
  path: string;
  commit: string;
  tasks: readonly number[];
}

/**
 * A native task candidate ready for `propose`. The record stays compact:
 * specification and plan bodies live in committed repository artifacts and
 * are referenced through `sourceRefs` only.
 */
export interface NativeTaskCandidate {
  id: string;
  title: string;
  kind: "design" | "plan" | "implementation" | "review" | "verification" | "documentation" | "operations";
  priority: "P0" | "P1" | "P2" | "P3";
  status: "proposed" | "ready";
  dependsOn: readonly string[];
  workflow: unknown;
  execution: unknown;
  sourceRefs: readonly SourceRef[];
  deliverables: readonly string[];
  acceptanceCriteria: readonly string[];
  verification: readonly string[];
  provenance: unknown;
  coordination: null;
  statusDetail: null;
}

/**
 * One optional visual artifact that materially governs a proposal's result.
 * Tracked artifacts are commit-pinned repository files; local artifacts stay
 * honest local paths until a consuming task preserves them.
 */
export interface VisualReferenceInput {
  id: string;
  path: string;
  availability: "tracked" | "local";
  commit?: string;
  format: "interactive-html" | "png" | "screenshot-set" | "diagram";
  governs: readonly string[];
  planTasks: readonly number[];
  verification: "context-only" | "structural" | "screenshot" | "structural-and-screenshot" | "manual";
}

/** One approved queue task, its immutable plan mapping, and any governing visuals. */
export interface PlannedTaskProposal {
  task: NativeTaskCandidate;
  plan: PlannedTaskRef;
  visualReferences?: readonly VisualReferenceInput[];
}

export interface MaterializePlannedTasksInput {
  source: TaskSource;
  idempotencyNamespace: string;
  proposals: readonly PlannedTaskProposal[];
}

export interface MaterializedTask {
  id: string;
  nativeRevision: string;
  sourceRefs: readonly SourceRef[];
}
