// Is each harness present, usable, and answering (QK-HARN-001, D7).
//
// v1's probe lived in src/smoke/host-runner.ts and ended in
// `catch { return "unknown"; }` — not-on-PATH, EACCES, and a hung binary all
// collapsed into one benign-looking string. That is the carried defect class in
// docs/DECISIONS.md:114-115 ("a permission failure is not evidence of death";
// "corrupt is distinguished from absent, and reported"). Every failure mode here
// stays distinguishable, and none of them is spelled "unknown".

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { RunnerKind } from "../runner/types.ts";

/** What each runner is called on disk (runner-boundary-probe.md:52 for cursor). */
export const DEFAULT_EXECUTABLES: Readonly<Record<RunnerKind, string>> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
};

/** v1 searched these beyond PATH; agent CLIs commonly install here. */
const EXTRA_SEARCH_DIRS: readonly string[] = [
  join(homedir(), ".local", "bin"),
  join(homedir(), "bin"),
];

const VERSION_TIMEOUT_MS = 5_000;
/** Auth checks are slower: `codex doctor` also probes network reachability. */
const AUTH_TIMEOUT_MS = 20_000;
const VERSION_MAX_CHARS = 64;
const STDERR_TAIL_CHARS = 200;

export type Presence =
  /** On disk and executable. */
  | { state: "present"; executable: string }
  /** Nothing by that name anywhere we looked. */
  | { state: "absent"; reason: string }
  /** Found, but we may not execute it. NOT the same as absent. */
  | { state: "denied"; executable: string; reason: string };

function isExecutable(path: string): Presence | null {
  try {
    accessSync(path, constants.F_OK);
  } catch {
    return null; // genuinely not here — keep looking
  }
  // It exists. From here on, a failure is a permission fact, not an absence.
  try {
    accessSync(path, constants.X_OK);
    return { state: "present", executable: path };
  } catch (err) {
    return {
      state: "denied",
      executable: path,
      reason: `found but not executable (${(err as { code?: string }).code ?? "EACCES"})`,
    };
  }
}

/** Resolve a command name against PATH plus the extra dirs. */
export function resolveExecutable(candidate: string): Presence {
  if (isAbsolute(candidate)) {
    return (
      isExecutable(candidate) ?? {
        state: "absent",
        reason: `no file at ${candidate}`,
      }
    );
  }

  const dirs = new Set<string>();
  for (const dir of process.env.PATH?.split(delimiter) ?? []) {
    if (dir.length > 0) dirs.add(dir);
  }
  for (const dir of EXTRA_SEARCH_DIRS) dirs.add(dir);

  // A found-but-denied hit outranks "keep looking" only if nothing else works,
  // so remember it and continue.
  let denied: Presence | null = null;
  for (const dir of dirs) {
    const found = isExecutable(join(dir, candidate));
    if (found?.state === "present") return found;
    if (found?.state === "denied" && denied === null) denied = found;
  }
  if (denied) return denied;
  return {
    state: "absent",
    reason: `${candidate} is not on PATH or in ~/.local/bin, ~/bin`,
  };
}

export type VersionProbe =
  | { state: "ok"; version: string }
  /** Ran and exited non-zero — the binary is there but unhappy. */
  | { state: "error"; reason: string; exitCode: number | null }
  /** Did not finish in time. Says nothing about whether it works. */
  | { state: "timeout"; reason: string }
  /** Could not be started at all. */
  | { state: "spawn-failed"; reason: string; code: string | null }
  /** We deliberately did not run it (no --probe, or not present). */
  | { state: "not-probed"; reason: string };

type RunOutcome =
  | { state: "ran"; exitCode: number | null; stdout: string; stderr: string }
  | { state: "timeout" }
  | { state: "spawn-failed"; message: string; code: string | null };

/** Run a bounded, output-capped command. Shared by the version and auth probes. */
function runBounded(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    const finish = (result: RunOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(executable, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 65536) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ state: "timeout" });
    }, timeoutMs);

    child.on("error", (err) => {
      finish({
        state: "spawn-failed",
        message: err.message,
        code: (err as { code?: string }).code ?? null,
      });
    });
    child.on("close", (exitCode) => finish({ state: "ran", exitCode, stdout, stderr }));
  });
}

/**
 * Run `<exe> --version` and report what actually happened. Every runner in the
 * probe used the same flag (v1 probeHostVersion switched on host and returned
 * `--version` in all three arms).
 */
export async function probeVersion(
  executable: string,
  timeoutMs: number = VERSION_TIMEOUT_MS,
): Promise<VersionProbe> {
  const run = await runBounded(executable, ["--version"], timeoutMs);
  if (run.state === "timeout") {
    return {
      state: "timeout",
      reason: `${executable} --version did not answer within ${timeoutMs}ms`,
    };
  }
  if (run.state === "spawn-failed") {
    return {
      state: "spawn-failed",
      reason: `could not start ${executable}: ${run.message}`,
      code: run.code,
    };
  }
  if (run.exitCode === 0) {
    const firstLine = run.stdout.trim().split("\n")[0]?.trim() ?? "";
    if (firstLine.length === 0) {
      return {
        state: "error",
        reason: `${executable} --version exited 0 but printed nothing`,
        exitCode: run.exitCode,
      };
    }
    return { state: "ok", version: firstLine.slice(0, VERSION_MAX_CHARS) };
  }
  const tail = run.stderr.trim().slice(0, STDERR_TAIL_CHARS);
  return {
    state: "error",
    reason: `${executable} --version exited ${run.exitCode}${tail ? `: ${tail}` : ""}`,
    exitCode: run.exitCode,
  };
}

export type AuthProbe =
  /** A positive machine-readable signal that credentials are present. */
  | { state: "authorized"; detail: string }
  /** A positive machine-readable signal that they are NOT. */
  | { state: "unauthorized"; detail: string }
  /** Ran but could not be read, or the command does not exist on this version. */
  | { state: "unknown"; detail: string }
  | { state: "not-probed"; reason: string };

/**
 * Each runner ships a purpose-built status command, so authorization costs no
 * tokens. `--version` proves a binary exists; it says nothing about credentials,
 * which is why availability used to be stuck at "unproven" forever.
 *
 * Shapes verified against the real CLIs on 2026-07-28:
 *   claude  `auth status`            → {"loggedIn": true, "authMethod": …}
 *   codex   `doctor --json`          → {schemaVersion, checks:{auth:{credentials:{status:"ok"}}}}
 *   cursor  `status --format json`   → {"status":"authenticated","isAuthenticated":true,…}
 */
const AUTH_ARGS: Readonly<Record<RunnerKind, readonly string[]>> = {
  claude: ["auth", "status"],
  codex: ["doctor", "--json"],
  cursor: ["status", "--format", "json"],
};

/** Read the runner's own answer. Only an explicit boolean counts either way —
 *  anything else is `unknown`, because a false "not logged in" would take a
 *  working harness out of service on no evidence. */
function readAuthJson(runner: RunnerKind, stdout: string): AuthProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { state: "unknown", detail: `${runner} status did not return JSON` };
  }
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

  const root = asRecord(parsed);
  if (!root) return { state: "unknown", detail: `${runner} status returned no object` };

  if (runner === "claude" || runner === "cursor") {
    const flag = runner === "claude" ? root.loggedIn : root.isAuthenticated;
    if (flag === true) return { state: "authorized", detail: "credentials present" };
    if (flag === false) return { state: "unauthorized", detail: `${runner} reports not logged in` };
    return { state: "unknown", detail: `${runner} status had no boolean to read` };
  }

  // codex: `checks` is a flat map whose KEYS are dotted ids — checks["auth.credentials"],
  // not a nested checks.auth.credentials. Each value carries {id, category, status},
  // so match on `category === "auth"` rather than the literal key, which survives
  // a key rename.
  const checks = asRecord(root.checks);
  if (!checks) return { state: "unknown", detail: "codex doctor had no checks to read" };
  for (const value of Object.values(checks)) {
    const check = asRecord(value);
    if (check?.category !== "auth") continue;
    if (check.status === "ok") return { state: "authorized", detail: "credentials present" };
    if (typeof check.status === "string") {
      return { state: "unauthorized", detail: `codex reports auth ${check.status}` };
    }
  }
  return { state: "unknown", detail: "codex doctor had no auth check to read" };
}

export async function probeAuth(
  runner: RunnerKind,
  executable: string,
  timeoutMs: number = AUTH_TIMEOUT_MS,
): Promise<AuthProbe> {
  const run = await runBounded(executable, AUTH_ARGS[runner], timeoutMs);
  if (run.state === "timeout") {
    return { state: "unknown", detail: `${runner} status did not answer within ${timeoutMs}ms` };
  }
  if (run.state === "spawn-failed") {
    return { state: "unknown", detail: `could not run ${runner} status: ${run.message}` };
  }
  // A non-zero exit may mean "logged out" or "this CLI has no such command".
  // Those are different, and we cannot tell them apart — so read the body, and
  // fall back to unknown rather than guessing.
  return readAuthJson(runner, run.stdout);
}

export interface RunnerProbe {
  runner: RunnerKind;
  /** What we looked for. */
  candidate: string;
  presence: Presence;
  version: VersionProbe;
  auth: AuthProbe;
}

export interface ProbeOptions {
  /** Run `--version` and the runner's auth-status command. Off by default:
   *  presence is free, executing anything is not. */
  probeVersions?: boolean;
  timeoutMs?: number;
  /** Override the executable name per runner. */
  executables?: Partial<Record<RunnerKind, string>>;
}

export const ALL_RUNNERS: readonly RunnerKind[] = ["claude", "codex", "cursor"];

/**
 * Presence for every runner, without executing anything. Synchronous on purpose:
 * this is `accessSync` on a handful of paths, so the run path can consult it
 * during plan assembly without spawning a process or going async (QK-HARN-002).
 */
export function presenceProbes(
  opts: Pick<ProbeOptions, "executables"> = {},
): RunnerProbe[] {
  return ALL_RUNNERS.map((runner): RunnerProbe => {
    const candidate = opts.executables?.[runner] ?? DEFAULT_EXECUTABLES[runner];
    const presence = resolveExecutable(candidate);
    const reason =
      presence.state === "absent"
        ? "not present — nothing to run"
        : presence.state === "denied"
          ? "found but not executable — refusing to claim it works"
          : "pass --probe to run it";
    return {
      runner,
      candidate,
      presence,
      version: { state: "not-probed", reason },
      auth: { state: "not-probed", reason },
    };
  });
}

/** Presence for every runner; version and auth only when asked (`--probe`). */
export async function probeRunners(opts: ProbeOptions = {}): Promise<RunnerProbe[]> {
  const base = presenceProbes(opts);
  if (!opts.probeVersions) return base;
  return Promise.all(
    base.map(async (probe): Promise<RunnerProbe> => {
      // Only a present binary is worth running; the others keep their reason.
      if (probe.presence.state !== "present") return probe;
      const [version, auth] = await Promise.all([
        probeVersion(probe.presence.executable, opts.timeoutMs),
        probeAuth(probe.runner, probe.presence.executable),
      ]);
      return { ...probe, version, auth };
    }),
  );
}
