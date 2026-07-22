import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitExecResult {
  stdout: string;
  stderr: string;
}

export async function runGit(repositoryRoot: string, args: readonly string[]): Promise<GitExecResult> {
  const { stdout, stderr } = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

export async function runGitInWorktree(worktreePath: string, args: readonly string[]): Promise<GitExecResult> {
  return runGit(worktreePath, args);
}
