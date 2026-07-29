// Claude argv. Learned facts (each cost a repair cycle):
// - the prompt must precede every flag — a variadic flag before it swallows it
// - --add-dir is variadic and must stay last
// - --output-format=stream-json requires --verbose (do not rely on settings.json)
// - effort tiers are quirks names; map to claude's low|medium|high|xhigh|max
// - --session-id must be a UUID; anything else exits 1 before any model call
// Ported from the bun-era src/runner/claude.ts (QK-MONO-005).

import { randomUUID } from "node:crypto";

/**
 * claude validates `--session-id` and refuses a non-UUID outright:
 *
 *     Error: Invalid session ID. Must be a valid UUID.
 *
 * observed at exit 1 in ~290ms, 2026-07-28, while diffing this port against the
 * bun-era Hono service. The bun-era hooks passed the JOB id here
 * (`implementer-QK-001-1769…`), so every claude dispatch was a guaranteed
 * non-zero exit — the third instance of the argv-bug class FOUNDING.md:250
 * already names twice, and on the wire it is indistinguishable from a vendor
 * quota refusal, which is precisely why routing refuses to attribute failures.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: string): boolean {
  return UUID.test(value);
}

/** A session id claude will accept. Distinct from the job id, which names the
 *  transcript and has no shape the CLI cares about. */
export function mintSessionId(): string {
  return randomUUID();
}

export interface ClaudeArgvInput {
  readonly executable: string;
  readonly sessionId: string;
  readonly model: string;
  readonly effort: string;
  /** The prompt text. Usually the brief's path; a reviewer's states its role. */
  readonly prompt: string;
  readonly workspace: string;
  readonly artifactDir: string;
}

const CLAUDE_EFFORTS: Readonly<Record<string, string>> = {
  mechanical: "low",
  standard: "medium",
  high: "high",
  principal: "xhigh",
};

export function claudeEffort(effort: string): string {
  return CLAUDE_EFFORTS[effort] ?? effort;
}

export function buildClaudeArgv(input: ClaudeArgvInput): readonly string[] {
  // Quirks imposes no tool restrictions (FOUNDING D12) — permission bypass is
  // the write posture, not a capability negotiation.
  return [
    input.executable,
    "-p",
    "--session-id",
    input.sessionId,
    // Prompt before every flag: a variadic flag placed before it would consume it.
    input.prompt,
    "--model",
    input.model,
    "--effort",
    claudeEffort(input.effort),
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    // --add-dir is variadic — stays last so nothing after is absorbed as a dir.
    "--add-dir",
    input.workspace,
    input.artifactDir,
  ];
}
