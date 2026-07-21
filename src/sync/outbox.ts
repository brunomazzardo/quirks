import { QuirksError } from "../core/errors.js";
import { EventJournal } from "../state/event-journal.js";
import type { JournalEvent } from "../state/types.js";
import { validateSchema } from "../schema/validate.js";
import type { TaskSourceResponse } from "../task-source/types.js";
import type { OutboxPort, SyncIntent, SyncState } from "./types.js";

const ENQUEUED_EVENT = "sync.intent.enqueued";
const TRANSITIONED_EVENT = "sync.intent.transitioned";

function assertSyncIntent(value: unknown): SyncIntent {
  return validateSchema<SyncIntent>("task-sync-intent-v1", value);
}

async function projectIntents(journal: EventJournal): Promise<{ byId: Map<string, SyncIntent>; byKey: Map<string, SyncIntent> }> {
  const events = await journal.read();
  const byId = new Map<string, SyncIntent>();
  const byKey = new Map<string, SyncIntent>();

  for (const event of events) {
    if (event.type === ENQUEUED_EVENT) {
      const intent = assertSyncIntent(event.data["intent"]);
      byId.set(intent.intentId, intent);
      byKey.set(intent.request.idempotencyKey, intent);
      continue;
    }
    if (event.type !== TRANSITIONED_EVENT) continue;

    const intentId = event.data["intentId"];
    const state = event.data["state"];
    const updatedAt = event.data["updatedAt"];
    if (typeof intentId !== "string" || typeof state !== "string" || typeof updatedAt !== "string") {
      throw new QuirksError("PROTOCOL_VIOLATION", "Malformed sync transition event");
    }

    const existing = byId.get(intentId);
    if (!existing) continue;

    const acknowledgement = event.data["acknowledgement"];
    const updated = assertSyncIntent({
      ...existing,
      state,
      updatedAt,
      ...(acknowledgement === undefined ? {} : { acknowledgement }),
    });
    byId.set(intentId, updated);
    byKey.set(updated.request.idempotencyKey, updated);
  }

  return { byId, byKey };
}

export class SyncOutbox implements OutboxPort {
  private constructor(private readonly journal: EventJournal) {}

  static open(filePath: string): SyncOutbox {
    return new SyncOutbox(new EventJournal(filePath));
  }

  async enqueue(intent: SyncIntent): Promise<void> {
    const projected = await projectIntents(this.journal);
    const existing = projected.byKey.get(intent.request.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== intent.requestHash) {
        throw new QuirksError("SOURCE_CONFLICT", "Idempotency key reused with different request hash");
      }
      return;
    }

    const validated = assertSyncIntent(intent);
    const event: JournalEvent = {
      schemaVersion: 1,
      id: validated.intentId,
      type: ENQUEUED_EVENT,
      at: validated.createdAt,
      data: { intent: validated },
    };
    await this.journal.append(event);
  }

  async transition(intentId: string, state: SyncState, acknowledgement?: TaskSourceResponse): Promise<void> {
    const projected = await projectIntents(this.journal);
    const existing = projected.byId.get(intentId);
    if (!existing) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Unknown sync intent ${intentId}`);
    }

    const updatedAt = new Date().toISOString();
    const event: JournalEvent = {
      schemaVersion: 1,
      id: `${intentId}:${state}:${updatedAt}`,
      type: TRANSITIONED_EVENT,
      at: updatedAt,
      data: {
        intentId,
        state,
        updatedAt,
        ...(acknowledgement === undefined ? {} : { acknowledgement }),
      },
    };
    await this.journal.append(event);
  }

  async acknowledge(intentId: string, acknowledgement: TaskSourceResponse): Promise<SyncIntent> {
    await this.transition(intentId, "acknowledged", acknowledgement);
    return (await this.get(intentId))!;
  }

  async conflict(intentId: string): Promise<SyncIntent> {
    await this.transition(intentId, "conflict");
    return (await this.get(intentId))!;
  }

  async pending(intentId: string): Promise<SyncIntent> {
    await this.transition(intentId, "pending");
    return (await this.get(intentId))!;
  }

  async get(intentId: string): Promise<SyncIntent | undefined> {
    const projected = await projectIntents(this.journal);
    return projected.byId.get(intentId);
  }

  async listPending(): Promise<SyncIntent[]> {
    const projected = await projectIntents(this.journal);
    return [...projected.byId.values()].filter((intent) => intent.state === "pending");
  }
}
