import { stat } from "node:fs/promises";
import { buildClaudeResumeArgv } from "./claude.js";
import { buildCodexResumeArgv, codexResultPath, codexResultSchemaPath } from "./codex.js";
import { buildCursorResumeArgv } from "./cursor.js";
import { dispatchRunnerJob, type DispatchRunnerJobInput } from "./dispatcher.js";
import type { SessionRecord, SessionRegistry } from "./sessions.js";
import type { RunnerJobResult, RunnerProfile } from "./types.js";
import { QuirksError } from "../core/errors.js";
import { EventJournal } from "../state/event-journal.js";

const RESUME_EVENT_TYPE = "runner.resume_attempted";
const DEFAULT_STALE_AFTER_MS = 30_000;

export type LivenessClassification = "active" | "paused" | "resumable" | "stale" | "exhausted" | "terminal";

export interface LivenessReport {
  schemaVersion: 1;
  jobId: string;
  pid: number;
  processAlive: boolean;
  outputGrowing: boolean;
  worktreeModified: boolean;
  transcriptRecoverable: boolean;
  resumeEligible: boolean;
  terminal: boolean;
  classification: LivenessClassification;
  checkedAt: string;
}

export interface WorktreePort {
  hasModifications(): Promise<boolean>;
}

export interface ProcessPort {
  isAlive(pid: number): boolean;
}

export interface ProbeLivenessDeps {
  registry: SessionRegistry;
  journal: EventJournal;
  worktree: WorktreePort;
  process?: ProcessPort;
  staleAfterMs?: number;
}

export interface ResumeJobDeps {
  registry: SessionRegistry;
  journal: EventJournal;
  profile: RunnerProfile;
  workspace: string;
  briefPath: string;
  artifactDir: string;
  timeoutMs: number;
  dispatch?: (input: DispatchRunnerJobInput) => Promise<RunnerJobResult>;
}

const defaultProcessPort: ProcessPort = {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
};

async function findSession(registry: SessionRegistry, jobId: string): Promise<SessionRecord> {
  const sessions = await registry.list();
  const session = sessions.find((entry) => entry.jobId === jobId);
  if (!session) {
    throw new QuirksError("PROTOCOL_VIOLATION", `No session registered for job ${jobId}`);
  }
  return session;
}

async function hasAttemptedResume(journal: EventJournal, jobId: string): Promise<boolean> {
  const events = await journal.read();
  return events.some((event) => event.type === RESUME_EVENT_TYPE && event.data["jobId"] === jobId);
}

async function isOutputGrowing(artifactPaths: readonly string[], staleAfterMs: number): Promise<boolean> {
  let latestMtimeMs: number | undefined;
  for (const artifactPath of artifactPaths) {
    try {
      const stats = await stat(artifactPath);
      if (latestMtimeMs === undefined || stats.mtimeMs > latestMtimeMs) {
        latestMtimeMs = stats.mtimeMs;
      }
    } catch {
      // Missing artifact carries no growth evidence; other paths may still qualify.
    }
  }
  if (latestMtimeMs === undefined) return false;
  return Date.now() - latestMtimeMs < staleAfterMs;
}

export async function probeLiveness(jobId: string, deps: ProbeLivenessDeps): Promise<LivenessReport> {
  const session = await findSession(deps.registry, jobId);
  const processPort = deps.process ?? defaultProcessPort;
  const staleAfterMs = deps.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  const processAlive = processPort.isAlive(session.pid);
  const outputGrowing = await isOutputGrowing(session.artifactPaths, staleAfterMs);
  const worktreeModified = await deps.worktree.hasModifications();
  const transcriptRecoverable = session.sessionHandle.length > 0;
  const checkedAt = new Date().toISOString();

  const base = {
    schemaVersion: 1 as const,
    jobId,
    pid: session.pid,
    processAlive,
    outputGrowing,
    worktreeModified,
    transcriptRecoverable,
    checkedAt,
  };

  if (session.terminalStatus !== undefined) {
    return { ...base, resumeEligible: false, terminal: true, classification: "terminal" };
  }

  if (processAlive && outputGrowing) {
    return { ...base, resumeEligible: false, terminal: false, classification: "active" };
  }

  if (processAlive && !outputGrowing) {
    return { ...base, resumeEligible: false, terminal: false, classification: "paused" };
  }

  const alreadyResumed = await hasAttemptedResume(deps.journal, jobId);
  if (alreadyResumed) {
    return { ...base, resumeEligible: false, terminal: true, classification: "exhausted" };
  }

  if (worktreeModified || transcriptRecoverable) {
    return { ...base, resumeEligible: true, terminal: false, classification: "resumable" };
  }

  return { ...base, resumeEligible: false, terminal: true, classification: "stale" };
}

function buildResumeArgv(
  profile: RunnerProfile,
  sessionHandle: string,
  posture: { workspace: string; briefPath: string; artifactDir: string; jobId: string },
): readonly string[] {
  if (!sessionHandle) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Cannot resume job without a recorded session handle");
  }
  switch (profile.runnerType) {
    case "claude":
      return buildClaudeResumeArgv(sessionHandle, {
        executable: profile.executable,
        model: profile.model,
        effort: profile.effort,
        briefPath: posture.briefPath,
        workspace: posture.workspace,
        artifactDir: posture.artifactDir,
        ...(profile.configDir !== undefined ? { configDir: profile.configDir } : {}),
      });
    case "codex":
      return buildCodexResumeArgv({
        executable: profile.executable,
        workspace: posture.workspace,
        sessionHandle,
        briefPath: posture.briefPath,
        resultPath: codexResultPath(posture.artifactDir, posture.jobId),
        schemaPath: codexResultSchemaPath(),
        capabilities: profile.capabilities,
        effort: profile.effort,
      });
    case "cursor":
      return buildCursorResumeArgv(sessionHandle, {
        executable: profile.executable,
        sessionId: sessionHandle,
        model: profile.model,
        briefPath: posture.briefPath,
        workspace: posture.workspace,
        artifactDir: posture.artifactDir,
        capabilities: profile.capabilities,
      });
    default: {
      const exhaustive: never = profile.runnerType;
      return exhaustive;
    }
  }
}

export async function resumeJob(jobId: string, deps: ResumeJobDeps): Promise<RunnerJobResult> {
  const session = await findSession(deps.registry, jobId);

  if (await hasAttemptedResume(deps.journal, jobId)) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Resume already attempted for job ${jobId}`);
  }

  const argv = buildResumeArgv(deps.profile, session.sessionHandle, {
    workspace: deps.workspace,
    briefPath: deps.briefPath,
    artifactDir: deps.artifactDir,
    jobId,
  });

  await deps.journal.append({
    schemaVersion: 1,
    id: `resume-${jobId}`,
    type: RESUME_EVENT_TYPE,
    at: new Date().toISOString(),
    data: { jobId, profileId: deps.profile.profileId, sessionHandle: session.sessionHandle },
  });

  const dispatch = deps.dispatch ?? dispatchRunnerJob;
  const result = await dispatch({
    jobId,
    profile: deps.profile,
    argv,
    artifactDir: deps.artifactDir,
    // Same binding the initial dispatch needs: claude has no workspace flag, so
    // without this a resumed job restarts in the supervisor's checkout rather
    // than its task worktree.
    cwd: deps.workspace,
    timeoutMs: deps.timeoutMs,
  });

  await deps.registry.update({
    jobId,
    artifactPaths: result.artifactPaths,
    ...(result.status === "success" ? { terminalStatus: result.status } : {}),
  });

  return result;
}
