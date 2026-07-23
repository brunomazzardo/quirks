import { access, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../core/canonical-json.js";
import { QuirksError } from "../core/errors.js";
import { parseSessionsDocument } from "../runner/sessions.js";
import { writeJsonAtomic } from "../state/atomic-file.js";
import { validateSchema } from "../schema/validate.js";
import { computeEnvelopeDigest, stripDigest } from "./envelope.js";
import type { CampaignApproval, CampaignEnvelope, CampaignEvent, CampaignSnapshot, StoredProgressEvent } from "./types.js";
import type { SessionRecord } from "../runner/sessions.js";

interface StoreOptions { stateDir: string; repositoryId: string; campaignId: string; envelope: CampaignEnvelope }

function campaignDirectory(stateDir: string, repositoryId: string, campaignId: string): string {
  return path.join(stateDir, "repositories", repositoryId.replaceAll(":", "-"), "campaigns", campaignId);
}

async function appendFrame(filePath: string, value: unknown): Promise<void> {
  const frame = canonicalJson(value);
  if (frame.includes("\n")) throw new QuirksError("PROTOCOL_VIOLATION", "Campaign journal frame must be one line");
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "a", 0o600);
  try { await handle.write(`${frame}\n`); await handle.sync(); } finally { await handle.close(); }
}

async function readFrames(filePath: string): Promise<unknown[]> {
  let content: string;
  try { content = await readFile(filePath, "utf8"); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, index) => {
    try { return JSON.parse(line) as unknown; } catch { throw new QuirksError("PROTOCOL_VIOLATION", `Malformed campaign journal frame at line ${index + 1}`); }
  });
}

export class CampaignStore {
  readonly campaignPath: string;
  readonly campaignFile: string;
  readonly eventsFile: string;
  readonly approvalsFile: string;
  readonly stateFile: string;
  readonly sessionsFile: string;
  readonly syncOutboxFile: string;
  readonly progressEventsFile: string;
  readonly tasksPath: string;
  readonly artifactsPath: string;

  private constructor(readonly stateDir: string, readonly repositoryId: string, readonly campaignId: string) {
    this.campaignPath = campaignDirectory(stateDir, repositoryId, campaignId);
    this.campaignFile = path.join(this.campaignPath, "campaign.json");
    this.eventsFile = path.join(this.campaignPath, "events.jsonl");
    this.approvalsFile = path.join(this.campaignPath, "approvals.jsonl");
    this.stateFile = path.join(this.campaignPath, "state.json");
    this.sessionsFile = path.join(this.campaignPath, "sessions.json");
    this.syncOutboxFile = path.join(this.campaignPath, "sync-outbox.jsonl");
    this.progressEventsFile = path.join(this.campaignPath, "progress.jsonl");
    this.tasksPath = path.join(this.campaignPath, "tasks");
    this.artifactsPath = path.join(this.campaignPath, "artifacts");
  }

  static async create(options: StoreOptions): Promise<CampaignStore> {
    validateSchema<CampaignEnvelope>("campaign-v1", options.envelope);
    if (options.envelope.campaignId !== options.campaignId || options.envelope.repositoryId !== options.repositoryId) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Campaign store identity does not match envelope");
    }
    if (computeEnvelopeDigest(stripDigest(options.envelope)) !== options.envelope.digest) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Campaign envelope digest mismatch");
    }
    const store = new CampaignStore(options.stateDir, options.repositoryId, options.campaignId);
    await mkdir(store.campaignPath, { recursive: true, mode: 0o700 });
    try { await access(store.campaignFile); throw new QuirksError("PROTOCOL_VIOLATION", "Campaign already exists"); } catch (error) {
      if (error instanceof QuirksError) throw error;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await Promise.all([mkdir(store.tasksPath, { recursive: true, mode: 0o700 }), mkdir(store.artifactsPath, { recursive: true, mode: 0o700 })]);
    await writeJsonAtomic(store.campaignFile, options.envelope);
    await Promise.all([open(store.eventsFile, "a", 0o600).then((h) => h.close()), open(store.approvalsFile, "a", 0o600).then((h) => h.close()), open(store.syncOutboxFile, "a", 0o600).then((h) => h.close()), open(store.progressEventsFile, "a", 0o600).then((h) => h.close())]);
    await writeJsonAtomic(store.sessionsFile, { schemaVersion: 1, sessions: [] });
    await store.writeState({ schemaVersion: 1, campaignId: options.campaignId, status: "awaiting_approval", digest: options.envelope.digest, updatedAt: new Date().toISOString() });
    return store;
  }

  static async open(stateDir: string, repositoryId: string, campaignId: string): Promise<CampaignStore> {
    const store = new CampaignStore(stateDir, repositoryId, campaignId);
    const envelope = validateSchema<CampaignEnvelope>("campaign-v1", JSON.parse(await readFile(store.campaignFile, "utf8")));
    if (envelope.campaignId !== campaignId || envelope.repositoryId !== repositoryId || computeEnvelopeDigest(stripDigest(envelope)) !== envelope.digest) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Campaign envelope digest mismatch");
    }
    return store;
  }

  async hasFile(name: string): Promise<boolean> {
    try { await access(path.join(this.campaignPath, name)); return true; } catch { return false; }
  }
  /**
   * Overwrite the stored envelope with a fresh one for the same campaign
   * identity. Create-once semantics stay with {@link CampaignStore.create};
   * replacement policy (which lifecycle states may be re-staged) is enforced
   * by the caller — see `stageCampaignEnvelope`.
   */
  async replaceEnvelope(envelope: CampaignEnvelope): Promise<void> {
    validateSchema<CampaignEnvelope>("campaign-v1", envelope);
    if (envelope.campaignId !== this.campaignId || envelope.repositoryId !== this.repositoryId) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Campaign store identity does not match envelope");
    }
    if (computeEnvelopeDigest(stripDigest(envelope)) !== envelope.digest) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Campaign envelope digest mismatch");
    }
    await writeJsonAtomic(this.campaignFile, envelope);
  }
  async readEnvelope(): Promise<CampaignEnvelope> { return validateSchema<CampaignEnvelope>("campaign-v1", JSON.parse(await readFile(this.campaignFile, "utf8"))); }
  async readState(): Promise<CampaignSnapshot> { return validateSchema<CampaignSnapshot>("campaign-state-v1", JSON.parse(await readFile(this.stateFile, "utf8"))); }
  async writeState(snapshot: CampaignSnapshot): Promise<void> { validateSchema<CampaignSnapshot>("campaign-state-v1", snapshot); await writeJsonAtomic(this.stateFile, snapshot); }
  async appendEvent(event: CampaignEvent): Promise<void> { validateSchema<CampaignEvent>("campaign-event-v1", event); await appendFrame(this.eventsFile, event); }
  async appendApproval(approval: CampaignApproval): Promise<void> { validateSchema<CampaignApproval>("campaign-approval-v1", approval); await appendFrame(this.approvalsFile, approval); }
  async readEvents(): Promise<CampaignEvent[]> { return (await readFrames(this.eventsFile)).map((entry) => validateSchema<CampaignEvent>("campaign-event-v1", entry)); }
  async readApprovals(): Promise<CampaignApproval[]> { return (await readFrames(this.approvalsFile)).map((entry) => validateSchema<CampaignApproval>("campaign-approval-v1", entry)); }
  async readSessionsDocument(): Promise<{ schemaVersion: 1; sessions: SessionRecord[] }> {
    return parseSessionsDocument(JSON.parse(await readFile(this.sessionsFile, "utf8")));
  }
  async writeSessionsDocument(document: { schemaVersion: 1; sessions: readonly SessionRecord[] }): Promise<void> {
    if (document.schemaVersion !== 1) throw new QuirksError("PROTOCOL_VIOLATION", "Malformed sessions document");
    await writeJsonAtomic(this.sessionsFile, { schemaVersion: 1, sessions: document.sessions.map((session) => ({ ...session, artifactPaths: [...session.artifactPaths] })) });
  }
  async appendProgressEvent(event: StoredProgressEvent): Promise<void> {
    if (event.schemaVersion !== 1 || typeof event.jobId !== "string" || typeof event.revision !== "number") {
      throw new QuirksError("PROTOCOL_VIOLATION", "Malformed progress event frame");
    }
    await appendFrame(this.progressEventsFile, event);
  }
  async readProgressEvents(): Promise<StoredProgressEvent[]> {
    return (await readFrames(this.progressEventsFile)).map((entry) => {
      if (typeof entry !== "object" || entry === null) throw new QuirksError("PROTOCOL_VIOLATION", "Malformed progress event frame");
      const record = entry as StoredProgressEvent;
      if (record.schemaVersion !== 1) throw new QuirksError("PROTOCOL_VIOLATION", "Malformed progress event frame");
      return record;
    });
  }
}
