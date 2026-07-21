import type { TaskSource } from "../task-source/task-source.js";
import { reconcilePending } from "./reconciler.js";
import type { OutboxPort, SyncBoundary, SyncIntent } from "./types.js";
import { REQUIRED_ACK_OPERATIONS } from "./types.js";

export interface SyncBoundaryInput {
  boundary: SyncBoundary;
  campaignId: string;
  outbox: OutboxPort & { listPending(campaignId?: string): Promise<SyncIntent[]> };
  source: TaskSource;
  taskIds: readonly string[];
}

export interface SyncBoundaryResult {
  ok: boolean;
  refreshedRevisions: Record<string, string>;
  pendingIntents: SyncIntent[];
  blockedReason?: string;
}

async function refreshRevisions(source: TaskSource, taskIds: readonly string[]): Promise<Record<string, string>> {
  const refreshedRevisions: Record<string, string> = {};
  for (const taskId of taskIds) {
    const response = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
    if (response.ok && response.operation === "show" && typeof response.nativeRevision === "string") {
      refreshedRevisions[taskId] = response.nativeRevision;
    }
  }
  return refreshedRevisions;
}

function blocksCompletion(boundary: SyncBoundary, pendingIntents: readonly SyncIntent[]): string | undefined {
  if (boundary !== "completion" && boundary !== "final-report") return undefined;
  const blocking = pendingIntents.filter((intent) => REQUIRED_ACK_OPERATIONS.has(intent.operation));
  if (blocking.length === 0) return undefined;
  return `Pending acknowledgement for ${blocking.map((intent) => intent.operation).join(", ")}`;
}

export async function syncBoundary(input: SyncBoundaryInput): Promise<SyncBoundaryResult> {
  const refreshedRevisions = await refreshRevisions(input.source, input.taskIds);
  await reconcilePending({ campaignId: input.campaignId, outbox: input.outbox, source: input.source });
  const pendingIntents = await input.outbox.listPending(input.campaignId);
  const blockedReason = blocksCompletion(input.boundary, pendingIntents);

  return {
    ok: blockedReason === undefined,
    refreshedRevisions,
    pendingIntents,
    ...(blockedReason ? { blockedReason } : {}),
  };
}
