import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedRoute } from "../campaign/routing.js";
import type { RunnerPort } from "../campaign/ports.js";
import { QuirksError } from "../core/errors.js";
import { buildClaudeArgv, buildClaudeEnv, claudeArtifactPaths } from "./claude.js";
import { buildCodexArgv, codexPromptText, codexResultPath, codexResultSchemaPath } from "./codex.js";
import { buildCursorArgv, cursorResultPath } from "./cursor.js";
import { dispatchRunnerJob } from "./dispatcher.js";
import type { RunnerJobResult, RunnerProfile } from "./types.js";

export interface RunnerDispatchInput {
  jobId: string;
  taskId: string;
  role: "supervisor" | "implementer" | "reviewer";
  route: ResolvedRoute;
  briefPath: string;
  worktreePath: string;
}

function requiredProfile(
  profiles: ReadonlyMap<string, RunnerProfile>,
  profileId: string,
): RunnerProfile {
  const profile = profiles.get(profileId);
  if (!profile) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Unknown runner profile ${profileId}`);
  }
  return profile;
}

export function sanitizedRunnerEnv(profile: RunnerProfile): Readonly<Record<string, string>> | undefined {
  if (profile.runnerType === "claude") {
    return buildClaudeEnv(profile.configDir ? { configDir: profile.configDir } : {});
  }
  return undefined;
}

async function readBriefContents(briefPath: string): Promise<string | undefined> {
  try {
    return await readFile(briefPath, "utf8");
  } catch {
    return undefined;
  }
}

export function buildRunnerArgv(
  profile: RunnerProfile,
  input: RunnerDispatchInput,
  artifactDir: string,
  briefContents?: string,
): readonly string[] {
  switch (profile.runnerType) {
    case "claude": {
      const sessionId = randomUUID();
      return buildClaudeArgv({
        executable: profile.executable,
        sessionId,
        model: profile.model,
        effort: profile.effort,
        briefPath: input.briefPath,
        workspace: input.worktreePath,
        ...(profile.configDir ? { configDir: profile.configDir } : {}),
        allowPermissionBypass: profile.capabilities.includes("repository-write"),
      });
    }
    case "codex": {
      return buildCodexArgv({
        executable: profile.executable,
        model: profile.model,
        workspace: input.worktreePath,
        promptText: codexPromptText(input.briefPath, briefContents),
        resultPath: codexResultPath(artifactDir, input.jobId),
        artifactDir,
        schemaPath: codexResultSchemaPath(),
        capabilities: profile.capabilities,
        effort: profile.effort,
      });
    }
    case "cursor": {
      const sessionId = randomUUID();
      return buildCursorArgv({
        executable: profile.executable,
        sessionId,
        model: profile.model,
        briefPath: input.briefPath,
        workspace: input.worktreePath,
        capabilities: [...profile.capabilities],
      });
    }
    default: {
      const exhaustive: never = profile.runnerType;
      return exhaustive;
    }
  }
}

export class CliRunnerPort implements RunnerPort {
  constructor(private readonly profiles: ReadonlyMap<string, RunnerProfile>) {}

  async dispatch(input: RunnerDispatchInput): Promise<RunnerJobResult> {
    const profile = requiredProfile(this.profiles, input.route.profileId);
    const artifactDir = path.dirname(input.briefPath);
    const briefContents = profile.runnerType === "codex"
      ? await readBriefContents(input.briefPath)
      : undefined;
    const argv = buildRunnerArgv(profile, input, artifactDir, briefContents);
    const dispatchInput = {
      jobId: input.jobId,
      profile,
      argv,
      artifactDir,
      timeoutMs: profile.wallClockMs,
    };
    const env = sanitizedRunnerEnv(profile);
    return dispatchRunnerJob(env ? { ...dispatchInput, env } : dispatchInput);
  }
}

export function artifactPathsForRunner(profile: RunnerProfile, artifactDir: string, jobId: string): readonly string[] {
  switch (profile.runnerType) {
    case "claude":
      return claudeArtifactPaths(artifactDir);
    case "codex":
      return [codexResultPath(artifactDir, jobId)];
    case "cursor":
      return [cursorResultPath(artifactDir, jobId)];
    default: {
      const exhaustive: never = profile.runnerType;
      return exhaustive;
    }
  }
}
