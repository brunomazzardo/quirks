import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sha256 } from "../../../src/core/hash.js";
import { GitWorktreeManager } from "../../../src/git/worktree.js";

const execFileAsync = promisify(execFile);

export interface GitFixture {
  root: string;
  repositoryId: string;
  head: string;
  commitWithChange: string;
  manager: GitWorktreeManager;
  implementerWorktreePath: string;
  stateDir: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.toString().trim();
}

export async function createGitFixture(): Promise<GitFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-git-fixture-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-git-state-"));
  process.env.QUIRKS_STATE_DIR = stateDir;

  await git(root, ["init"]);
  await git(root, ["config", "user.email", "fixture@quirks.test"]);
  await git(root, ["config", "user.name", "Quirks Fixture"]);
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "initial"]);
  const head = await git(root, ["rev-parse", "HEAD"]);

  await writeFile(path.join(root, "change.txt"), "change\n", "utf8");
  await git(root, ["add", "change.txt"]);
  await git(root, ["commit", "-m", "change"]);
  const commitWithChange = await git(root, ["rev-parse", "HEAD"]);

  const repositoryId = sha256({ root });
  const manager = await GitWorktreeManager.open({
    repositoryRoot: root,
    repositoryId,
    campaignId: "cmp-git-1",
    campaignBranch: "quirks/cmp-git-1/integration",
    baseCommit: head,
    stateDir,
  });

  await manager.ensureIntegrationBranch({
    repositoryRoot: root,
    campaignId: "cmp-git-1",
    baseCommit: head,
    campaignBranch: "quirks/cmp-git-1/integration",
  });

  const implementer = await manager.prepareTaskWorktree("QK-9", head);

  return {
    root,
    repositoryId,
    head,
    commitWithChange,
    manager,
    implementerWorktreePath: implementer.path,
    stateDir,
  };
}
