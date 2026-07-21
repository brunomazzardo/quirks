import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { QuirksError } from "../core/errors.js";
import { sha256 } from "../core/hash.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import { validateSchema } from "../schema/validate.js";
import { canonicalRepository } from "./repository.js";
import type {
  CompletionBoundary,
  EvidenceKind,
  ProjectConfig,
  ProjectContext,
  ProjectWorkflowPolicy,
  TaskStatus,
} from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CONFIG_PATH = ".agents/quirks.json";

const TASK_STATUSES = [
  "proposed",
  "ready",
  "claimed",
  "in_review",
  "blocked",
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatus[];

const COMPLETION_BOUNDARIES = [
  "accepted-commit",
  "campaign-merge",
  "target-merge",
  "remote-push",
] as const satisfies readonly CompletionBoundary[];

const EVIDENCE_KINDS = [
  "commit",
  "campaign-merge",
  "target-merge",
  "remote-push",
  "review",
  "verification",
  "ci",
  "deployment",
] as const satisfies readonly EvidenceKind[];

const IDENTITY_STATUS_MAP = Object.freeze(
  Object.fromEntries(TASK_STATUSES.map((status) => [status, status])),
) as Readonly<Record<string, TaskStatus>>;

const STANDARD_EVIDENCE_MAP = Object.freeze({
  "accepted-commit": Object.freeze(["commit", "review", "verification"] as const),
  "campaign-merge": Object.freeze(["campaign-merge", "commit", "review", "verification"] as const),
  "target-merge": Object.freeze(["target-merge", "campaign-merge", "commit", "review", "verification", "ci"] as const),
  "remote-push": Object.freeze(["remote-push", "target-merge", "campaign-merge", "commit", "review", "verification", "ci", "deployment"] as const),
}) as Readonly<Record<CompletionBoundary, readonly EvidenceKind[]>>;

const DEFAULT_COMPLETION_BOUNDARIES = Object.freeze([...COMPLETION_BOUNDARIES]);

function cloneStatusMap(map: Readonly<Record<string, TaskStatus>>): Record<string, TaskStatus> {
  return { ...map };
}

function cloneEvidenceMap(
  map: Readonly<Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>>,
): Partial<Record<CompletionBoundary, readonly EvidenceKind[]>> {
  return Object.fromEntries(
    Object.entries(map).map(([boundary, evidenceKinds]) => [boundary, [...evidenceKinds]]),
  ) as Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>;
}

function cloneCompletionBoundaries(boundaries: readonly CompletionBoundary[]): CompletionBoundary[] {
  return [...boundaries];
}

function hasNonEmptyNativeStatusMap(
  nativeStatusMap: ProjectWorkflowPolicy["nativeStatusMap"],
): nativeStatusMap is Readonly<Record<string, TaskStatus>> {
  return Boolean(nativeStatusMap && Object.keys(nativeStatusMap).length > 0);
}

function hasNonEmptyEvidenceMap(
  evidenceMap: ProjectWorkflowPolicy["evidenceMap"],
): evidenceMap is Readonly<Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>> {
  return Boolean(evidenceMap && Object.keys(evidenceMap).length > 0);
}

function hasNonEmptyAllowedCompletionBoundaries(
  allowedCompletionBoundaries: ProjectWorkflowPolicy["allowedCompletionBoundaries"],
): allowedCompletionBoundaries is readonly CompletionBoundary[] {
  return Boolean(allowedCompletionBoundaries && allowedCompletionBoundaries.length > 0);
}

export interface LoadProjectContextOptions {
  mode: "inspection" | "unattended";
  configPath?: string;
}

async function resolveConfigFile(root: string, configPath: string): Promise<string> {
  const normalized = assertRepositoryRelativePath(configPath);
  const candidate = path.join(root, normalized);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing project configuration at ${normalized}`);
  }
  const rootReal = await realpath(root);
  const relative = path.relative(rootReal, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Config path escapes repository: ${normalized}`);
  }
  return resolved;
}

async function isConfigTracked(root: string, configPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", root, "ls-files", "--error-unmatch", "--", configPath]);
    return true;
  } catch {
    return false;
  }
}

function normalizeConfig(config: ProjectConfig): ProjectConfig {
  if (config.taskSource.driver === "json") {
    return {
      ...config,
      taskSource: {
        ...config.taskSource,
        path: assertRepositoryRelativePath(config.taskSource.path),
      },
    };
  }
  return config;
}

function assertSkillNames(skills: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(skills)) {
    if (value.length === 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Empty workflow skill name for ${JSON.stringify(name)}`);
    }
  }
}

function assertNativeStatusMap(nativeStatusMap: Readonly<Record<string, TaskStatus>>): void {
  for (const [nativeStatus, mappedStatus] of Object.entries(nativeStatusMap)) {
    if (!TASK_STATUSES.includes(mappedStatus)) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Unknown normalized status for ${JSON.stringify(nativeStatus)}`);
    }
  }
}

function assertEvidenceMap(evidenceMap: Readonly<Partial<Record<CompletionBoundary, readonly EvidenceKind[]>>>): void {
  for (const [boundary, evidenceKinds] of Object.entries(evidenceMap) as [CompletionBoundary, readonly EvidenceKind[]][]) {
    if (!COMPLETION_BOUNDARIES.includes(boundary)) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Unknown completion boundary ${JSON.stringify(boundary)}`);
    }
    for (const evidenceKind of evidenceKinds) {
      if (!EVIDENCE_KINDS.includes(evidenceKind)) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Unknown evidence kind ${JSON.stringify(evidenceKind)}`);
      }
    }
  }
}

function assertAllowedCompletionBoundaries(allowedCompletionBoundaries: readonly CompletionBoundary[]): void {
  if (allowedCompletionBoundaries.length === 0) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Workflow policy must allow at least one completion boundary");
  }
  for (const boundary of allowedCompletionBoundaries) {
    if (!COMPLETION_BOUNDARIES.includes(boundary)) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Unknown completion boundary ${JSON.stringify(boundary)}`);
    }
  }
}

function buildEffectiveWorkflowPolicy(config: ProjectConfig): Required<ProjectWorkflowPolicy> {
  const { workflowPolicy, taskSource } = config;
  assertSkillNames(workflowPolicy.skills);

  if (taskSource.driver === "external") {
    if (
      !hasNonEmptyNativeStatusMap(workflowPolicy.nativeStatusMap) ||
      !hasNonEmptyEvidenceMap(workflowPolicy.evidenceMap) ||
      !hasNonEmptyAllowedCompletionBoundaries(workflowPolicy.allowedCompletionBoundaries)
    ) {
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        "External task sources require explicit workflow policy mappings or capability metadata",
      );
    }

    const nativeStatusMap = cloneStatusMap(workflowPolicy.nativeStatusMap);
    const evidenceMap = cloneEvidenceMap(workflowPolicy.evidenceMap);
    const allowedCompletionBoundaries = cloneCompletionBoundaries(workflowPolicy.allowedCompletionBoundaries);

    assertNativeStatusMap(nativeStatusMap);
    assertEvidenceMap(evidenceMap);
    assertAllowedCompletionBoundaries(allowedCompletionBoundaries);

    return {
      skills: { ...workflowPolicy.skills },
      nativeStatusMap,
      evidenceMap,
      allowedCompletionBoundaries,
    };
  }

  const nativeStatusMap = cloneStatusMap(workflowPolicy.nativeStatusMap ?? IDENTITY_STATUS_MAP);
  const evidenceMap = cloneEvidenceMap(workflowPolicy.evidenceMap ?? STANDARD_EVIDENCE_MAP);
  const allowedCompletionBoundaries = cloneCompletionBoundaries(
    workflowPolicy.allowedCompletionBoundaries ?? DEFAULT_COMPLETION_BOUNDARIES,
  );

  assertNativeStatusMap(nativeStatusMap);
  assertEvidenceMap(evidenceMap);
  assertAllowedCompletionBoundaries(allowedCompletionBoundaries);

  return {
    skills: { ...workflowPolicy.skills },
    nativeStatusMap,
    evidenceMap,
    allowedCompletionBoundaries,
  };
}

export async function loadProjectContext(
  startDir: string,
  options: LoadProjectContextOptions,
): Promise<ProjectContext> {
  const { root, repositoryId } = await canonicalRepository(startDir);
  const configPath = assertRepositoryRelativePath(options.configPath ?? DEFAULT_CONFIG_PATH);
  const configFile = await resolveConfigFile(root, configPath);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configFile, "utf8")) as unknown;
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Invalid JSON in project configuration at ${configPath}`);
  }
  const validated = validateSchema<ProjectConfig>("project-config-v1", raw);
  const config = normalizeConfig(validated);
  const effectiveWorkflowPolicy = buildEffectiveWorkflowPolicy(config);
  const configTracked = await isConfigTracked(root, configPath);

  if (options.mode === "unattended" && !configTracked) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Unattended mode requires a committed project configuration");
  }

  return {
    root,
    repositoryId,
    configPath,
    configTracked,
    config,
    effectiveWorkflowPolicy,
    configHash: sha256(config),
  };
}
