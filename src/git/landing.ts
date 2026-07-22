import { QuirksError } from "../core/errors.js";
import { runGit } from "./argv.js";

export interface ApprovedPush {
  remote: string;
  branch: string;
}

export interface LandingGitConfig {
  campaignBranch: string;
  targetBranch: string;
  expectedTargetCommit: string;
  push: {
    enabled: boolean;
    remote?: string;
    branch?: string;
  };
}

export interface LandingInput {
  repositoryRoot: string;
  git: LandingGitConfig;
  approvedPush?: ApprovedPush;
  prePushVerification?: () => Promise<void>;
}

export interface LandingResult {
  mergeCommit: string;
  targetCommit: string;
  pushed: boolean;
  pushRef?: string;
}

let landingLock: Promise<void> = Promise.resolve();

async function withLandingLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = landingLock;
  let release!: () => void;
  landingLock = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function assertApprovedPush(input: LandingInput): ApprovedPush {
  const { git } = input;
  if (!git.push.enabled) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Push is not enabled in the approved envelope");
  }
  if (!input.approvedPush) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Approved push remote and branch are required");
  }
  if (!git.push.remote || !git.push.branch) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Envelope push remote and branch are required when push is enabled");
  }
  if (git.push.remote !== input.approvedPush.remote || git.push.branch !== input.approvedPush.branch) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Push remote or branch does not match approved envelope");
  }
  return input.approvedPush;
}

export async function mergeCampaignToTarget(input: LandingInput): Promise<LandingResult> {
  return withLandingLock(async () => {
    const { repositoryRoot, git } = input;

    const currentTarget = (await runGit(repositoryRoot, ["rev-parse", git.targetBranch])).stdout.trim();
    if (currentTarget !== git.expectedTargetCommit) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Target branch drifted from expected commit", {
        expected: git.expectedTargetCommit,
        actual: currentTarget,
      });
    }

    const status = await runGit(repositoryRoot, ["status", "--porcelain"]);
    if (status.stdout.trim().length > 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Target repository has uncommitted changes");
    }

    await runGit(repositoryRoot, ["checkout", git.targetBranch]);
    await runGit(repositoryRoot, [
      "merge",
      "--no-ff",
      git.campaignBranch,
      "-m",
      `Merge campaign branch ${git.campaignBranch}`,
    ]);
    const mergeCommit = (await runGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();

    if (input.prePushVerification) {
      await input.prePushVerification();
    }

    if (!git.push.enabled) {
      return { mergeCommit, targetCommit: mergeCommit, pushed: false };
    }

    const approvedPush = assertApprovedPush(input);
    await runGit(repositoryRoot, ["push", approvedPush.remote, `HEAD:${approvedPush.branch}`]);
    return {
      mergeCommit,
      targetCommit: mergeCommit,
      pushed: true,
      pushRef: `${approvedPush.remote}/${approvedPush.branch}`,
    };
  });
}

export interface LandingPort {
  mergeCampaignToTarget(input: LandingInput): Promise<LandingResult>;
}

export const defaultLandingPort: LandingPort = {
  mergeCampaignToTarget,
};
