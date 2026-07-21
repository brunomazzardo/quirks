export interface JournalEvent {
  schemaVersion: 1;
  id: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface RepositoryLockRecord {
  schemaVersion: 1;
  scope: "local-clone";
  campaignId: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
}

export interface RepositoryLockHandle {
  readonly scope: "local-clone";
  readonly record: RepositoryLockRecord;
  heartbeat(): Promise<void>;
  release(): Promise<void>;
}
