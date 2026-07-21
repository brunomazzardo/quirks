import { QuirksError } from "../../../src/core/errors.js";
import type { SyncIntent, SyncState } from "../../../src/sync/types.js";
import type { TaskSourceResponse } from "../../../src/task-source/types.js";

export class MemoryOutbox {
  readonly transitions: SyncState[] = [];
  private intents = new Map<string, SyncIntent>();

  async enqueue(intent: SyncIntent): Promise<void> {
    const existing = this.intents.get(intent.intentId);
    if (existing) {
      if (existing.requestHash !== intent.requestHash) {
        throw new QuirksError("SOURCE_CONFLICT", "Idempotency key reused with different request hash");
      }
      return;
    }
    this.intents.set(intent.intentId, intent);
    this.transitions.push("pending");
  }

  async transition(intentId: string, state: SyncState, acknowledgement?: TaskSourceResponse): Promise<void> {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error("missing intent");
    this.intents.set(intentId, {
      ...intent,
      state,
      updatedAt: "2026-07-21T00:00:01.000Z",
      ...(acknowledgement ? { acknowledgement } : {}),
    });
    this.transitions.push(state);
  }

  async get(intentId: string): Promise<SyncIntent | undefined> {
    return this.intents.get(intentId);
  }

  get intent(): SyncIntent | undefined {
    return this.intents.values().next().value;
  }
}
