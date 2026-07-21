import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QuirksError } from "../core/errors.js";

const execFileAsync = promisify(execFile);

export interface GitInspection {
  baseCommit: string;
  dirty: boolean;
  branch?: string;
}

export interface InspectGitOptions {
  mode: "inspection" | "unattended";
}

export async function inspectGit(repositoryRoot: string, options: InspectGitOptions): Promise<GitInspection> {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
    execFileAsync("git", ["-C", repositoryRoot, "status", "--porcelain"]),
  ]);

  let branch: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, "symbolic-ref", "--short", "HEAD"]);
    branch = stdout.trim() || undefined;
  } catch {
    // Detached HEAD has no symbolic branch; the immutable commit remains authoritative.
  }

  const dirty = status.length > 0;
  if (dirty && options.mode !== "inspection") {
    throw new QuirksError("PROTOCOL_VIOLATION", "Unattended campaigns require a clean Git worktree");
  }

  return { baseCommit: revision.trim(), dirty, ...(branch ? { branch } : {}) };
}
