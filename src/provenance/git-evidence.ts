import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import { QuirksError } from "../core/errors.js";
import type { Identity } from "./types.js";

const execFileAsync = promisify(execFile);

const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

export function assertGitSha(sha: string): string {
  if (!GIT_SHA_PATTERN.test(sha)) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `Invalid Git commit SHA: ${JSON.stringify(sha)}`);
  }
  return sha;
}

export function isValidGitSha(sha: string): boolean {
  return GIT_SHA_PATTERN.test(sha);
}

async function gitExec(root: string, args: readonly string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      code: typeof execError.code === "number" ? execError.code : 1,
    };
  }
}

export async function commitExists(root: string, sha: string): Promise<boolean> {
  const result = await gitExec(root, ["cat-file", "-e", `${sha}^{commit}`]);
  return result.code === 0;
}

export async function pathExistsAtCommit(root: string, sha: string, relativePath: string): Promise<boolean> {
  const normalized = assertRepositoryRelativePath(relativePath);
  const result = await gitExec(root, ["cat-file", "-e", `${sha}:${normalized}`]);
  return result.code === 0;
}

interface RawGitIdentity {
  name: string;
  email: string;
}

function formatGitIdentity(identity: RawGitIdentity): string {
  return `${identity.name} <${identity.email}>`;
}

export async function readCommitIdentities(root: string, sha: string): Promise<{ author: RawGitIdentity; committer: RawGitIdentity }> {
  const result = await gitExec(root, [
    "show",
    "--no-patch",
    "--format=%an%x00%ae%x00%cn%x00%ce",
    sha,
  ]);
  if (result.code !== 0) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `Commit ${sha} is not available`);
  }
  const [authorName = "", authorEmail = "", committerName = "", committerEmail = ""] = result.stdout.trim().split("\0");
  return {
    author: { name: authorName, email: authorEmail },
    committer: { name: committerName, email: committerEmail },
  };
}

export function labelGitIdentity(identity: RawGitIdentity, verified: boolean): Identity {
  return {
    label: formatGitIdentity(identity),
    evidence: verified ? "git-signature" : "self-asserted-git-metadata",
    verified,
  };
}

function parseSignerFromVerifyOutput(output: string): string | undefined {
  for (const line of output.split("\n")) {
    const goodsig = line.match(/^\[GNUPG:\] GOODSIG ([0-9A-Fa-f]{8,40}) /);
    if (goodsig) return goodsig[1];
    const validsig = line.match(/^\[GNUPG:\] VALIDSIG ([0-9A-Fa-f]{40}) /);
    if (validsig) return validsig[1];
  }
  return undefined;
}

export function isAllowListedSigner(signer: string | undefined, allowedSigners: readonly string[]): boolean {
  if (!signer) return false;
  const normalized = signer.toLowerCase();
  return allowedSigners.some((allowed) => {
    const candidate = allowed.toLowerCase();
    return normalized === candidate || normalized.endsWith(candidate);
  });
}

export async function verifyCommitSignature(
  root: string,
  sha: string,
  allowedSigners: readonly string[],
): Promise<{ verified: boolean; signer?: string }> {
  const result = await gitExec(root, ["verify-commit", "--raw", sha]);
  if (result.code !== 0) return { verified: false };
  const signer = parseSignerFromVerifyOutput(`${result.stdout}\n${result.stderr}`);
  const verified = isAllowListedSigner(signer, allowedSigners);
  if (verified && signer) return { verified: true, signer };
  return { verified: false };
}

export async function isAncestor(root: string, ancestorSha: string, descendantSha: string): Promise<boolean> {
  const result = await gitExec(root, ["merge-base", "--is-ancestor", ancestorSha, descendantSha]);
  return result.code === 0;
}

export async function readSignatureStatusMetadata(root: string, sha: string): Promise<string> {
  const result = await gitExec(root, ["show", "--no-patch", "--format=%G?", sha]);
  return result.stdout.trim();
}
