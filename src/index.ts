export const QUIRKS_PROTOCOL_VERSION = 1 as const;

export { QuirksError, type QuirksErrorCode } from "./core/errors.js";
export { loadProjectContext, type LoadProjectContextOptions } from "./project/config.js";
export type {
  CompletionBoundary,
  EvidenceKind,
  ProjectConfig,
  ProjectContext,
  ProjectWorkflowPolicy,
  TaskStatus,
} from "./project/types.js";
export { createTaskSource, type CreateTaskSourceOptions } from "./task-source/factory.js";
export type { CredentialResolver } from "./task-source/credentials.js";
export { disposeTaskSource, type TaskSource } from "./task-source/task-source.js";
export type {
  MutationOperation,
  MutationRequest,
  TaskSourceCapabilities,
  TaskSourceOperation,
  TaskSourceRequest,
  TaskSourceResponse,
} from "./task-source/types.js";
export { SyncOutbox } from "./sync/outbox.js";
export { reconcileMutation, reconcilePending } from "./sync/reconciler.js";
export { syncBoundary } from "./sync/boundaries.js";
export type { SyncBoundary, SyncIntent, SyncState } from "./sync/types.js";
export { runPreflight, type PreflightResult } from "./campaign/preflight.js";
export { CampaignStore } from "./campaign/store.js";
export { CampaignSupervisor } from "./campaign/supervisor.js";
export { recoverCampaign, recoverCampaignOrThrow } from "./campaign/recovery.js";
export { createApprovalChallenge, consumeApprovalToken } from "./campaign/approval.js";
export type { BuildTaskHistoryInput } from "./provenance/read-model.js";
export type { TaskHistory, TaskProvenance } from "./provenance/types.js";
