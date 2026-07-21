import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createGitFixture(): Promise<{ root: string; baseCommit: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-provenance-"));
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Fixture Author"]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs/spec.md"), "# Executed spec\n");
  await execFileAsync("git", ["-C", root, "add", "docs/spec.md"]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "docs: add executed spec"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
  await writeFile(path.join(root, "docs/current-only.md"), "# Current only\n");
  return { root, baseCommit: stdout.trim() };
}
