export type TaskSourceConfig =
  | { driver: "json"; path: string }
  | { driver: "external"; command: readonly [string, ...string[]]; credentialAlias?: string };

export type TaskStatus = "proposed" | "ready" | "claimed" | "in_review" | "blocked" | "completed" | "cancelled";
export type CompletionBoundary = "accepted-commit" | "campaign-merge" | "target-merge" | "remote-push";
export type EvidenceKind = "commit" | "campaign-merge" | "target-merge" | "remote-push" | "review" | "verification" | "ci" | "deployment";

export interface ProjectWorkflowPolicy {
  skills: Readonly<Record<string, string>>;
  nativeStatusMap?: Readonly<Record<string, TaskStatus>>;
  evidenceMap?: Readonly<Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>>;
  allowedCompletionBoundaries?: readonly CompletionBoundary[];
}

export interface ProjectConfig {
  schemaVersion: 1;
  protocol: "quirks-project-v1";
  taskSource: TaskSourceConfig;
  workflowPolicy: ProjectWorkflowPolicy;
}

export interface ProjectContext {
  root: string;
  repositoryId: string;
  configPath: string;
  configTracked: boolean;
  config: ProjectConfig;
  effectiveWorkflowPolicy: Required<ProjectWorkflowPolicy>;
  configHash: string;
}
