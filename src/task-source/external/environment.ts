import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BLOCKED_ENV_NAMES = new Set([
  "NODE_OPTIONS",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "CI",
  "CI_JOB_TOKEN",
  "NPM_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

const WINDOWS_PLATFORM_KEYS = ["SystemRoot", "COMSPEC", "PATHEXT", "WINDIR"] as const;
const UNIX_PLATFORM_KEYS = ["LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"] as const;

export interface ScrubbedEnvironmentOptions {
  explicitVariables: Readonly<Record<string, string>>;
  credentialVariables: Readonly<Record<string, string>>;
  projectedFiles?: Readonly<Record<string, string>>;
}

export interface ScrubbedEnvironment {
  env: NodeJS.ProcessEnv;
  sandboxRoot: string;
  cleanup(): Promise<void>;
}

function isBlockedExplicitEnvName(name: string): boolean {
  if (BLOCKED_ENV_NAMES.has(name)) return true;
  if (name === "HOME" || name === "USERPROFILE") return true;
  return false;
}

export async function createScrubbedEnvironment(
  options: ScrubbedEnvironmentOptions,
): Promise<ScrubbedEnvironment> {
  const sandboxRoot = await mkdtemp(path.join(os.tmpdir(), "quirks-adapter-"));
  await chmod(sandboxRoot, 0o700);

  for (const [relativePath, content] of Object.entries(options.projectedFiles ?? {})) {
    const absolutePath = path.join(sandboxRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, { mode: 0o600 });
  }

  const env: NodeJS.ProcessEnv = {};

  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }

  const platformKeys = process.platform === "win32" ? WINDOWS_PLATFORM_KEYS : UNIX_PLATFORM_KEYS;
  for (const key of platformKeys) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  if (process.platform === "win32") {
    env.USERPROFILE = sandboxRoot;
  } else {
    env.HOME = sandboxRoot;
  }

  for (const [key, value] of Object.entries(options.explicitVariables)) {
    if (isBlockedExplicitEnvName(key)) {
      throw new Error(`Explicit adapter variable ${key} is not allowed`);
    }
    env[key] = value;
  }

  for (const [key, value] of Object.entries(options.credentialVariables)) {
    if (isBlockedExplicitEnvName(key)) {
      throw new Error(`Credential variable ${key} is not allowed`);
    }
    env[key] = value;
  }

  return {
    env,
    sandboxRoot,
    async cleanup() {
      await rm(sandboxRoot, { recursive: true, force: true });
    },
  };
}
