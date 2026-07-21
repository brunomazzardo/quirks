import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { sha256 } from "../core/hash.js";

const execFileAsync = promisify(execFile);

export async function canonicalRepository(startDir: string): Promise<{ root: string; repositoryId: string }> {
  const { stdout } = await execFileAsync("git", ["-C", startDir, "rev-parse", "--show-toplevel"]);
  const root = await realpath(stdout.trim());
  return { root, repositoryId: sha256({ root }) };
}
