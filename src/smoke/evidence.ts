import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rejectSecretShapedValues } from "../task-source/task-source.js";
import type { HostRunnerEvidence, SmokeHost, SmokeOutcome, SmokeRunner } from "./types.js";

const MAX_EVIDENCE_BYTES = 16_384;
const HOME_DIR = os.homedir();

const FORBIDDEN_EVIDENCE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
];

export function isApprovedSmokeRun(approved?: boolean): boolean {
  if (approved === true) return true;
  if (approved === false) return false;
  return process.env.QUIRKS_SMOKE_APPROVED === "approve-paid-runner-probes";
}

export function assertBoundedEvidenceValue(value: string, label: string): void {
  if (value.length > 512) {
    throw new Error(`${label} exceeds bounded evidence length`);
  }
  for (const pattern of FORBIDDEN_EVIDENCE_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`${label} contains credential-shaped content`);
    }
  }
  if (value.includes(HOME_DIR)) {
    throw new Error(`${label} contains absolute home path`);
  }
}

export function validateHostRunnerEvidence(value: unknown): HostRunnerEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Evidence must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("Evidence schemaVersion must be 1");
  const host = record.host;
  const runner = record.runner;
  if (host !== "claude" && host !== "codex" && host !== "cursor") {
    throw new Error("Evidence host must be claude, codex, or cursor");
  }
  if (runner !== "claude" && runner !== "codex" && runner !== "cursor") {
    throw new Error("Evidence runner must be claude, codex, or cursor");
  }
  const outcome = record.outcome;
  if (outcome !== "passed" && outcome !== "failed" && outcome !== "blocked") {
    throw new Error("Evidence outcome must be passed, failed, or blocked");
  }
  if (typeof record.sessionAvailable !== "boolean") {
    throw new Error("Evidence sessionAvailable must be boolean");
  }
  if (!Array.isArray(record.deviations) || !record.deviations.every((entry) => typeof entry === "string")) {
    throw new Error("Evidence deviations must be a string array");
  }

  const stringFields = [
    "date",
    "os",
    "hostVersion",
    "runnerVersion",
    "model",
    "effort",
    "profileId",
    "artifactDigest",
  ] as const;
  for (const field of stringFields) {
    if (typeof record[field] !== "string") {
      throw new Error(`Evidence ${field} must be a string`);
    }
    assertBoundedEvidenceValue(record[field] as string, field);
  }
  for (const deviation of record.deviations) {
    assertBoundedEvidenceValue(deviation, "deviation");
  }
  if (!/^[a-f0-9]{64}$/.test(record.artifactDigest as string) && (record.artifactDigest as string) !== "n/a") {
    throw new Error("Evidence artifactDigest must be a 64-char hex digest or n/a");
  }

  rejectSecretShapedValues(value);
  return value as HostRunnerEvidence;
}

export function digestBoundedPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function blockedEvidence(input: {
  host: SmokeHost;
  runner: SmokeRunner;
  reason: string;
  hostVersion?: string;
  runnerVersion?: string;
  profileId?: string;
  extraDeviations?: readonly string[];
}): HostRunnerEvidence {
  const date = new Date().toISOString().slice(0, 10);
  const deviations = [input.reason, ...(input.extraDeviations ?? [])];
  return {
    schemaVersion: 1,
    date,
    os: process.platform,
    host: input.host,
    hostVersion: input.hostVersion ?? "blocked",
    runner: input.runner,
    runnerVersion: input.runnerVersion ?? "blocked",
    model: "n/a",
    effort: "n/a",
    profileId: input.profileId ?? "n/a",
    outcome: "blocked",
    sessionAvailable: false,
    artifactDigest: "n/a",
    deviations,
  };
}

export async function persistEvidence(
  evidence: HostRunnerEvidence,
  evidenceDir: string,
): Promise<string> {
  validateHostRunnerEvidence(evidence);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_EVIDENCE_BYTES) {
    throw new Error("Evidence exceeds maximum serialized size");
  }
  await mkdir(evidenceDir, { recursive: true });
  const fileName = `${evidence.date}-${evidence.host}-${evidence.runner}.json`;
  const absolute = path.join(evidenceDir, fileName);
  await writeFile(absolute, serialized, "utf8");
  return absolute;
}

export async function readEvidenceFile(filePath: string): Promise<HostRunnerEvidence> {
  const raw = await readFile(filePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_EVIDENCE_BYTES) {
    throw new Error("Evidence file exceeds maximum size");
  }
  return validateHostRunnerEvidence(JSON.parse(raw) as unknown);
}

function redactProfileId(profileId: string): string {
  if (profileId === "n/a") return "n/a";
  return profileId.replace(/[a-z0-9]{8,}/gi, (match) => `${match.slice(0, 4)}…`);
}

function formatOutcome(outcome: SmokeOutcome, deviations: readonly string[]): string {
  if (deviations.length === 0) {
    return outcome;
  }
  return `${outcome}:${deviations.join(",")}`;
}

export function projectMatrixMarkdown(records: readonly HostRunnerEvidence[]): string {
  const sorted = [...records].toSorted((left, right) => {
    const hostOrder = left.host.localeCompare(right.host);
    if (hostOrder !== 0) return hostOrder;
    return left.runner.localeCompare(right.runner);
  });
  const lines = [
    "# 2026 host/runner smoke matrix",
    "",
    "| Date | OS | Host | Host version | Runner | Runner version | Model/effort | Profile (redacted) | Outcome | Artifact digest |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const record of sorted) {
    const modelEffort = record.model === "n/a" ? "n/a" : `${record.model}/${record.effort}`;
  lines.push(
      `| ${record.date} | ${record.os} | ${record.host} | ${record.hostVersion} | ${record.runner} | ${record.runnerVersion} | ${modelEffort} | ${redactProfileId(record.profileId)} | ${formatOutcome(record.outcome, record.deviations)} | ${record.artifactDigest} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
