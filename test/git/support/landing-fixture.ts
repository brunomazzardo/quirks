import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LandingFixture {
  root: string;
  bareRemote: string;
  baseCommit: string;
  targetCommit: string;
  campaignBranch: string;
  targetBranch: string;
  remoteBranch: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.toString().trim();
}

export async function createLandingFixture(): Promise<LandingFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-landing-fixture-"));
  const bareRemote = await mkdtemp(path.join(os.tmpdir(), "quirks-landing-remote-"));

  await git(root, ["init"]);
  await git(root, ["config", "user.email", "landing@quirks.test"]);
  await git(root, ["config", "user.name", "Quirks Landing"]);
  await writeFile(path.join(root, "README.md"), "# landing fixture\n", "utf8");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "initial"]);
  const baseCommit = await git(root, ["rev-parse", "HEAD"]);

  await git(root, ["branch", "-M", "main"]);
  const targetCommit = baseCommit;

  await git(bareRemote, ["init", "--bare"]);
  await git(root, ["remote", "add", "origin", bareRemote]);
  await git(root, ["push", "-u", "origin", "main"]);

  const campaignBranch = "quirks/cmp-landing/integration";
  await git(root, ["checkout", "-b", campaignBranch]);
  await writeFile(path.join(root, "campaign.txt"), "accepted\n", "utf8");
  await git(root, ["add", "campaign.txt"]);
  await git(root, ["commit", "-m", "campaign work"]);
  await git(root, ["checkout", "main"]);

  return {
    root,
    bareRemote,
    baseCommit,
    targetCommit,
    campaignBranch,
    targetBranch: "main",
    remoteBranch: "main",
  };
}
