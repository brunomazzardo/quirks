import type { MutationOperation, MutationRequest, TaskSourceResponse } from "../task-source/types.js";

export type SyncState = "pending" | "acknowledged" | "conflict" | "failed";

export interface SyncIntent {
  schemaVersion: 1;
  intentId: string;
  campaignId: string;
  taskId: string;
  operation: MutationOperation;
  requestHash: string;
  request: MutationRequest;
  state: SyncState;
  createdAt: string;
  updatedAt: string;
  acknowledgement?: TaskSourceResponse;
}

export interface OutboxPort {
  enqueue(intent: SyncIntent): Promise<void>;
  transition(intentId: string, state: SyncState, acknowledgement?: TaskSourceResponse): Promise<void>;
  listPending?(): Promise<SyncIntent[]>;
}

export type SyncBoundary =
  | "preflight"
  | "claim"
  | "resume"
  | "review"
  | "completion"
  | "landing"
  | "final-report";

export const REQUIRED_ACK_OPERATIONS = new Set<MutationOperation>(["complete", "attach-provenance"]);
