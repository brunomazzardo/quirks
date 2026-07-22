import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { inspectGit } from "../campaign/git-inspect.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { writeJsonAtomic } from "../state/atomic-file.js";
import type { GitWorktreePort } from "../campaign/ports.js";
import { runGit, runGitInWorktree } from "./argv.js";
import type { GitWorktreeRecord, GitWorktreeStore } from "./types.js";

export interface GitWorktreeManagerOptions {
  repositoryRoot: string;
  repositoryId: string;
  campaignId: string;
  campaignBranch: string;
  baseCommit: string;
  stateDir?: string;
}

function taskBranchName(campaignId: string, taskId: string): string {
  return `quirks/${campaignId}/task/${taskId}`;
}

function reviewBranchName(campaignId: string, taskId: string): string {
  return `quirks/${campaignId}/review/${taskId}`;
}

function storePath(stateDir: string, repositoryId: string, campaignId: string): string {
  const campaignDir = resolveAppPaths(repositoryId, campaignId).campaign
    ?? path.join(stateDir, "repositories", repositoryId.replace(":", "-"), "campaigns", campaignId);
  return path.join(campaignDir, "worktrees.json");
}

async function loadStore(filePath: string, campaignId: string): Promise<GitWorktreeStore> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as GitWorktreeStore;
    if (raw.campaignId !== campaignId) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Worktree store campaign mismatch");
    }
    return raw;
  } catch (error) {
    if (error instanceof QuirksError) throw error;
    return {
      schemaVersion: 1,
      campaignId,
      integrationBranch: "",
      integrationCommit: "",
      worktrees: [],
    };
  }
}

export class GitWorktreeManager implements GitWorktreePort {
  private readonly storeFile: string;
  private store: GitWorktreeStore | undefined;

  private constructor(private readonly options: GitWorktreeManagerOptions) {
    const stateDir = options.stateDir ?? resolveAppPaths(options.repositoryId).root;
    this.storeFile = storePath(stateDir, options.repositoryId, options.campaignId);
  }

  static async open(options: GitWorktreeManagerOptions): Promise<GitWorktreeManager> {
    const manager = new GitWorktreeManager(options);
    await inspectGit(options.repositoryRoot, { mode: "unattended" });
    manager.store = await loadStore(manager.storeFile, options.campaignId);
    return manager;
  }

  async ensureIntegrationBranch(input: {
    repositoryRoot: string;
    campaignId: string;
    baseCommit: string;
    campaignBranch: string;
  }): Promise<{ branch: string; commit: string }> {
    if (input.baseCommit !== this.options.baseCommit) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Integration branch base commit mismatch");
    }

    const branches = await runGit(input.repositoryRoot, ["branch", "--list", input.campaignBranch]);
    if (!branches.stdout.includes(input.campaignBranch)) {
      await runGit(input.repositoryRoot, ["branch", input.campaignBranch, input.baseCommit]);
    }

    const head = await runGit(input.repositoryRoot, ["rev-parse", input.campaignBranch]);
    const commit = head.stdout.trim();
    if (commit !== input.baseCommit) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Integration branch points at wrong commit");
    }

    await this.persist({
      integrationBranch: input.campaignBranch,
      integrationCommit: commit,
    });
    return { branch: input.campaignBranch, commit };
  }

  async prepareTaskWorktree(taskId: string, baseCommit: string): Promise<{ path: string; branch: string }> {
    return this.prepareRoleWorktree(taskId, baseCommit, "implementer");
  }

  async prepareReviewWorktree(taskId: string, candidateCommit: string): Promise<{ path: string; branch: string }> {
    const lane = await this.prepareRoleWorktree(taskId, this.options.baseCommit, "reviewer");
    await runGit(lane.path, ["checkout", candidateCommit]);
    return lane;
  }

  private async prepareRoleWorktree(taskId: string, baseCommit: string, role: "implementer" | "reviewer"): Promise<{ path: string; branch: string }> {
    if (baseCommit !== this.options.baseCommit) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Task worktree base commit mismatch");
    }

    const store = await this.readStore();
    const existing = store.worktrees.find((record) => record.taskId === taskId && (record.role ?? "implementer") === role);
    if (existing) {
      return { path: existing.path, branch: existing.branch };
    }

    const branch = role === "reviewer" ? reviewBranchName(this.options.campaignId, taskId) : taskBranchName(this.options.campaignId, taskId);
    const worktreeRoot = path.join(path.dirname(this.storeFile), "worktrees");
    await mkdir(worktreeRoot, { recursive: true });
    const worktreePath = path.join(worktreeRoot, `${taskId}-${role}`);

    await runGit(this.options.repositoryRoot, ["worktree", "add", "-B", branch, worktreePath, baseCommit]);

    const record: GitWorktreeRecord = {
      schemaVersion: 1,
      campaignId: this.options.campaignId,
      taskId,
      path: worktreePath,
      branch,
      baseCommit,
      createdAt: new Date().toISOString(),
      role,
    };
    store.worktrees.push(record);
    await writeJsonAtomic(this.storeFile, store);
    this.store = store;
    return { path: worktreePath, branch };
  }

  async listModifiedFiles(worktreePath: string): Promise<readonly string[]> {
    const { stdout } = await runGitInWorktree(worktreePath, ["status", "--porcelain"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3).trim())
      .filter((file) => file.length > 0);
  }

  async readCommit(worktreePath: string): Promise<string | undefined> {
    try {
      const { stdout } = await runGitInWorktree(worktreePath, ["rev-parse", "HEAD"]);
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  get records(): readonly GitWorktreeRecord[] {
    return this.store?.worktrees ?? [];
  }

  get storeFilePath(): string {
    return this.storeFile;
  }

  get repositoryRoot(): string {
    return this.options.repositoryRoot;
  }

  private async readStore(): Promise<GitWorktreeStore> {
    if (!this.store) {
      this.store = await loadStore(this.storeFile, this.options.campaignId);
    }
    return this.store;
  }

  private async persist(partial: Partial<Pick<GitWorktreeStore, "integrationBranch" | "integrationCommit">>): Promise<void> {
    const store = await this.readStore();
    const next: GitWorktreeStore = {
      ...store,
      ...partial,
    };
    await writeJsonAtomic(this.storeFile, next);
    this.store = next;
  }
}

export { taskBranchName, reviewBranchName };
