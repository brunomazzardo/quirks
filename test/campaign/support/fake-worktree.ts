export interface WorktreePort {
  prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }>;
  listModifiedFiles(path: string): Promise<readonly string[]>;
  readCommit(path: string): Promise<string | undefined>;
}

export interface FakeWorktreeRecord {
  path: string;
  branch: string;
  modifiedFiles: string[];
  commit?: string;
}

export class FakeWorktreePort implements WorktreePort {
  readonly prepared: Array<{ taskId: string; baseCommit: string; record: FakeWorktreeRecord }> = [];
  private readonly records = new Map<string, FakeWorktreeRecord>();

  seed(taskId: string, record: FakeWorktreeRecord): void {
    this.records.set(taskId, record);
  }

  async prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }> {
    const existing = this.records.get(taskId);
    const record = existing ?? {
      path: `/tmp/quirks-worktree/${taskId}`,
      branch: `quirks/task/${taskId}`,
      modifiedFiles: [],
      commit: baseCommit,
    };
    this.records.set(taskId, record);
    this.prepared.push({ taskId, baseCommit, record });
    return { path: record.path, branch: record.branch };
  }

  async listModifiedFiles(worktreePath: string): Promise<readonly string[]> {
    for (const record of this.records.values()) {
      if (record.path === worktreePath) return record.modifiedFiles;
    }
    return [];
  }

  async readCommit(worktreePath: string): Promise<string | undefined> {
    for (const record of this.records.values()) {
      if (record.path === worktreePath) return record.commit;
    }
    return undefined;
  }
}
