export type SmokeHost = "claude" | "codex" | "cursor";
export type SmokeRunner = SmokeHost;
export type SmokeOutcome = "passed" | "failed" | "blocked";

export interface HostRunnerEvidence {
  schemaVersion: 1;
  date: string;
  os: string;
  host: SmokeHost;
  hostVersion: string;
  runner: SmokeRunner;
  runnerVersion: string;
  model: string;
  effort: string;
  profileId: string;
  outcome: SmokeOutcome;
  sessionAvailable: boolean;
  artifactDigest: string;
  deviations: string[];
}

export interface SmokeHostConfig {
  schemaVersion: 1;
  hosts: Record<SmokeHost, { executable: string }>;
}

export const SMOKE_MATRIX: ReadonlyArray<{ host: SmokeHost; runner: SmokeRunner }> = [
  { host: "claude", runner: "claude" },
  { host: "claude", runner: "codex" },
  { host: "claude", runner: "cursor" },
  { host: "codex", runner: "claude" },
  { host: "codex", runner: "codex" },
  { host: "codex", runner: "cursor" },
  { host: "cursor", runner: "claude" },
  { host: "cursor", runner: "codex" },
  { host: "cursor", runner: "cursor" },
];

export const SMOKE_APPROVAL_ENV = "approve-paid-runner-probes";

export const BOUNDED_CAMPAIGN_APPROVAL_ENV = "approve-exact-campaign";

/** Default single-cell PoC — currently the most reliable real-host path. */
export const SMOKE_POC_CELL = { host: "cursor" as const, runner: "cursor" as const };
