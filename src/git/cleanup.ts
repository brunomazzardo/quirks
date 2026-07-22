import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "../state/atomic-file.js";
import { runGit } from "./argv.js";
import type { GitWorktreeManager } from "./worktree.js";
import type { GitWorktreeStore } from "./types.js";

export interface CleanupOptions {
  force?: boolean;
}

export async function cleanupWorktrees(
  manager: GitWorktreeManager,
  campaignId: string,
  options: CleanupOptions = {},
): Promise<{ removed: string[] }> {
  const storeFile = manager.storeFilePath;
  const raw = JSON.parse(await readFile(storeFile, "utf8")) as GitWorktreeStore;
  if (raw.campaignId !== campaignId) {
    return { removed: [] };
  }

  const backupPath = `${storeFile}.cleanup-backup`;
  await writeJsonAtomic(backupPath, raw);

  const removed: string[] = [];
  for (const record of raw.worktrees) {
    try {
      await runGit(manager.repositoryRoot, ["worktree", "remove", record.path, ...(options.force ? ["--force"] : [])]);
      removed.push(record.path);
    } catch {
      if (options.force) {
        await runGit(manager.repositoryRoot, ["worktree", "remove", "--force", record.path]).catch(() => undefined);
        removed.push(record.path);
      }
    }
  }

  const nextStore: GitWorktreeStore = {
    ...raw,
    worktrees: [],
  };
  await writeJsonAtomic(storeFile, nextStore);

  if (removed.length === 0 && raw.worktrees.length === 0) {
    return { removed: [] };
  }

  return { removed };
}
