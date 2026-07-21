import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertTierCompatible } from "../campaign/routing.js";
import type { JudgmentTier } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { validateSchema } from "../schema/validate.js";
import { rejectSecretShapedValues } from "../task-source/task-source.js";
import type { HostProfile, RunnerProfile } from "./types.js";

export interface LoadRunnerProfilesOptions {
  configDir?: string;
}

export interface LoadHostProfileOptions {
  configDir?: string;
}

interface TierAlias {
  tier: JudgmentTier;
}

interface ProfilesFile {
  schemaVersion: 1;
  tierAliases: Readonly<Record<string, TierAlias>>;
  profiles: readonly unknown[];
}

const REQUIRED_PROFILE_FIELDS = [
  "quotaPoolId",
  "tier",
  "model",
  "effort",
  "capabilities",
] as const satisfies readonly (keyof RunnerProfile)[];

export function resolveUserConfigDir(override?: string): string {
  if (override) return override;
  if (process.env.QUIRKS_CONFIG_DIR) return process.env.QUIRKS_CONFIG_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), "quirks");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "quirks");
}

function sanitizeProfile(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const { credential: _credential, ...rest } = raw as Record<string, unknown>;
  return rest;
}

function parseProfilesFile(raw: unknown): ProfilesFile {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "profiles.json must be an object");
  }
  const file = raw as Record<string, unknown>;
  if (file.schemaVersion !== 1) {
    throw new QuirksError("PROTOCOL_VIOLATION", "profiles.json schemaVersion must be 1");
  }
  if (typeof file.tierAliases !== "object" || file.tierAliases === null || Array.isArray(file.tierAliases)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "profiles.json tierAliases must be an object");
  }
  if (!Array.isArray(file.profiles)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "profiles.json profiles must be an array");
  }
  return {
    schemaVersion: 1,
    tierAliases: file.tierAliases as Readonly<Record<string, TierAlias>>,
    profiles: file.profiles,
  };
}

function assertRequiredProfileFields(profile: RunnerProfile): void {
  for (const field of REQUIRED_PROFILE_FIELDS) {
    const value = profile[field];
    if (value === undefined || value === null) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Runner profile ${profile.profileId} is missing ${field}`);
    }
    if (field === "capabilities" && (!Array.isArray(value) || value.length === 0)) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Runner profile ${profile.profileId} must declare capabilities`);
    }
    if (typeof value === "string" && value.length === 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Runner profile ${profile.profileId} must declare ${field}`);
    }
  }
}

function assertTierAliasCompatible(
  profile: RunnerProfile,
  tierAliases: Readonly<Record<string, TierAlias>>,
): void {
  const alias = tierAliases[profile.model];
  if (!alias) return;
  assertTierCompatible(profile.tier, { tier: alias.tier, profileId: profile.profileId });
}

async function readConfigJson(configDir: string, fileName: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path.join(configDir, fileName), "utf8");
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing user configuration file ${fileName} in ${configDir}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Invalid JSON in user configuration file ${fileName}`);
  }
  rejectSecretShapedValues(parsed);
  return parsed;
}

export async function loadRunnerProfiles(
  options: LoadRunnerProfilesOptions = {},
): Promise<readonly RunnerProfile[]> {
  const configDir = resolveUserConfigDir(options.configDir);
  const parsed = await readConfigJson(configDir, "profiles.json");
  const file = parseProfilesFile(parsed);
  rejectSecretShapedValues(file.tierAliases);

  const profiles: RunnerProfile[] = [];
  for (const rawProfile of file.profiles) {
    const sanitized = sanitizeProfile(rawProfile);
    rejectSecretShapedValues(sanitized);
    const profile = validateSchema<RunnerProfile>("runner-profile-v1", sanitized);
    assertRequiredProfileFields(profile);
    assertTierAliasCompatible(profile, file.tierAliases);
    profiles.push(profile);
  }
  return profiles;
}

export async function loadHostProfile(
  options: LoadHostProfileOptions = {},
): Promise<HostProfile> {
  const configDir = resolveUserConfigDir(options.configDir);
  const parsed = await readConfigJson(configDir, "host-profile.json");
  return validateSchema<HostProfile>("host-profile-v1", parsed);
}
