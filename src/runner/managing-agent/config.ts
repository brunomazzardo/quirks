import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveUserConfigDir } from "../profiles.js";

/**
 * The interpreting model, fixed rather than configured.
 *
 * Owner decision (2026-07-24): sonnet interprets. Haiku was rejected for a
 * specific reason — the load-bearing behaviour here is *refusing to guess* a
 * verdict, and that is exactly where a smaller model drifts invisibly. Leaving
 * this configurable would let that decision be undone by editing a JSON file,
 * so a change of model is a change of design.
 */
export const MANAGING_AGENT_MODEL = "sonnet";

export interface InterpreterConfig {
  executable: string;
  model: string;
  /** Wall-clock bound for one interpretation call. */
  wallClockMs: number;
  /** How much of a transcript is sent to the agent before the middle is elided. */
  excerptBudgetBytes: number;
  /** CLAUDE_CONFIG_DIR for the account the interpreter runs under. */
  configDir?: string;
}

export const DEFAULT_INTERPRETER_CONFIG: InterpreterConfig = {
  executable: "claude",
  model: MANAGING_AGENT_MODEL,
  wallClockMs: 300_000,
  // ~64k tokens of transcript. Measured: a real reviewer transcript is 25-60 KB,
  // so this carries whole runs, and the elision marker keeps the rare long one
  // honest rather than silently cropped.
  excerptBudgetBytes: 262_144,
};

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * Read the optional `interpreter` block from the user's profiles.json.
 *
 * Absent configuration is the normal case and yields the defaults; a missing or
 * unreadable file is never an error here, because the interpreter's executable
 * failing to launch is reported per job with the transcript kept, which is more
 * useful than refusing to start.
 */
export async function loadInterpreterConfig(
  options: { configDir?: string } = {},
): Promise<InterpreterConfig> {
  const configDir = resolveUserConfigDir(options.configDir);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(configDir, "profiles.json"), "utf8")) as unknown;
  } catch {
    return DEFAULT_INTERPRETER_CONFIG;
  }
  if (typeof raw !== "object" || raw === null) return DEFAULT_INTERPRETER_CONFIG;
  const block = (raw as Record<string, unknown>)["interpreter"];
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return DEFAULT_INTERPRETER_CONFIG;
  }
  const entries = block as Record<string, unknown>;
  return {
    executable: typeof entries["executable"] === "string" && entries["executable"].length > 0
      ? entries["executable"]
      : DEFAULT_INTERPRETER_CONFIG.executable,
    // Deliberately not read from configuration: see MANAGING_AGENT_MODEL.
    model: MANAGING_AGENT_MODEL,
    wallClockMs: positiveInteger(entries["wallClockMs"], DEFAULT_INTERPRETER_CONFIG.wallClockMs),
    excerptBudgetBytes: positiveInteger(
      entries["excerptBudgetBytes"],
      DEFAULT_INTERPRETER_CONFIG.excerptBudgetBytes,
    ),
    ...(typeof entries["configDir"] === "string" && entries["configDir"].length > 0
      ? { configDir: entries["configDir"] }
      : {}),
  };
}
