import type { SyncIntent, SyncState } from "../../../src/sync/types.js";
import type { TaskSourceResponse } from "../../../src/task-source/types.js";

export class MemoryOutbox {
  readonly transitions: SyncState[] = [];
  intent?: SyncIntent;

  async enqueue(intent: SyncIntent): Promise<void> {
    this.intent = intent;
    this.transitions.push("pending");
  }

  async transition(intentId: string, state: SyncState, acknowledgement?: TaskSourceResponse): Promise<void> {
    if (!this.intent || this.intent.intentId !== intentId) throw new Error("missing intent");
    this.intent = {
      ...this.intent,
      state,
      updatedAt: "2026-07-21T00:00:01.000Z",
      ...(acknowledgement ? { acknowledgement } : {}),
    };
    this.transitions.push(state);
  }
}
