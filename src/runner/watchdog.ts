import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { classifyFailure } from "../campaign/failures.js";
import { applyEvent } from "../campaign/state-machine.js";
import type { CampaignStore } from "../campaign/store.js";
import type { CampaignEvent } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { writeJsonAtomic } from "../state/atomic-file.js";
import { SessionRegistry } from "./sessions.js";
import type { RunnerProfile } from "./types.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;

export interface HeartbeatRecord {
  schemaVersion: 1;
  jobId: string;
  campaignId: string;
  pid: number;
  sessionHandle: string;
  startedAt: string;
  updatedAt: string;
  revision: number;
  status: "starting" | "running" | "timeout" | "terminal";
  terminalStatus?: string;
}

export interface StartDetachedJobInput {
  store: CampaignStore;
  profile: RunnerProfile;
  argv: readonly string[];
  timeoutMs: number;
  jobId?: string;
  role?: "supervisor" | "implementer" | "reviewer";
  cancelScope?: string;
  heartbeatIntervalMs?: number;
}

export interface LivenessReport {
  pid: number;
  sessionHandle: string;
  outputGrowing: boolean;
  terminal: boolean;
  lastHeartbeatAt: string;
}

interface DispatchRecord {
  jobId: string;
  campaignId: string;
  profile: RunnerProfile;
  argv: readonly string[];
  timeoutMs: number;
  cancelScope: string;
  role: "supervisor" | "implementer" | "reviewer";
  sessionHandle: string;
  artifactDir: string;
  artifactPaths: readonly string[];
  heartbeatIntervalMs: number;
}

interface ActiveMonitor {
  pid: number;
  stdoutPath: string;
  lastStdoutBytes: number;
  heartbeatTimer: NodeJS.Timeout;
  timeoutTimer: NodeJS.Timeout;
  finished: boolean;
  child?: ChildProcess;
}

const activeMonitors = new Map<string, ActiveMonitor>();

export function heartbeatPath(store: CampaignStore, jobId: string): string {
  return path.join(store.artifactsPath, jobId, "heartbeat.json");
}

function dispatchRecordPath(store: CampaignStore, jobId: string): string {
  return path.join(store.artifactsPath, jobId, "dispatch.json");
}

function extractFlagValue(argv: readonly string[], flag: string): string | undefined {
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function createJobId(explicit?: string): string {
  return explicit ?? `job-${randomBytes(8).toString("hex")}`;
}

function artifactPathsForJob(store: CampaignStore, jobId: string): readonly string[] {
  const relative = path.join("artifacts", jobId);
  return [
    path.join(relative, "stdout.log"),
    path.join(relative, "stderr.log"),
    path.join(relative, "result.json"),
    path.join(relative, "heartbeat.json"),
  ];
}

function assertHeartbeatRecord(value: unknown): HeartbeatRecord {
  if (typeof value !== "object" || value === null) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Heartbeat record must be an object");
  }
  const record = value as Partial<HeartbeatRecord>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.jobId !== "string" ||
    typeof record.campaignId !== "string" ||
    typeof record.pid !== "number" ||
    typeof record.sessionHandle !== "string" ||
    typeof record.startedAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.revision !== "number" ||
    (record.status !== "starting" &&
      record.status !== "running" &&
      record.status !== "timeout" &&
      record.status !== "terminal") ||
    (record.terminalStatus !== undefined && typeof record.terminalStatus !== "string")
  ) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Malformed heartbeat record");
  }
  return {
    schemaVersion: 1,
    jobId: record.jobId,
    campaignId: record.campaignId,
    pid: record.pid,
    sessionHandle: record.sessionHandle,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    status: record.status,
    ...(record.terminalStatus === undefined ? {} : { terminalStatus: record.terminalStatus }),
  };
}

async function readDispatchRecord(store: CampaignStore, jobId: string): Promise<DispatchRecord> {
  const raw = JSON.parse(await readFile(dispatchRecordPath(store, jobId), "utf8")) as DispatchRecord;
  return raw;
}

async function writeDispatchRecord(store: CampaignStore, record: DispatchRecord): Promise<void> {
  await writeJsonAtomic(dispatchRecordPath(store, record.jobId), record);
}

export async function readHeartbeat(store: CampaignStore, jobId: string): Promise<HeartbeatRecord> {
  return assertHeartbeatRecord(JSON.parse(await readFile(heartbeatPath(store, jobId), "utf8")));
}

async function writeHeartbeat(
  store: CampaignStore,
  current: HeartbeatRecord,
  patch: Partial<HeartbeatRecord>,
): Promise<HeartbeatRecord> {
  const next: HeartbeatRecord = {
    ...current,
    ...patch,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(heartbeatPath(store, current.jobId), next);
  return next;
}

async function appendRunnerEvent(store: CampaignStore, event: CampaignEvent): Promise<void> {
  await store.appendEvent(event);
}

async function pauseForRunnerTimeout(store: CampaignStore, jobId: string): Promise<void> {
  const snapshot = await store.readState();
  if (snapshot.status !== "running") {
    return;
  }
  const at = new Date().toISOString();
  const failureClass = classifyFailure({ status: "timeout" });
  const event: CampaignEvent = {
    schemaVersion: 1,
    id: `runner-timeout:${jobId}:${at}`,
    type: "runner.timeout",
    at,
    actor: "watchdog",
    from: "running",
    to: "paused",
    reason: "runner_timeout",
    evidence: {
      jobId,
      failureClass,
    },
  };
  await appendRunnerEvent(store, event);
  await store.writeState(applyEvent(snapshot, event));
}

async function touchHeartbeat(
  store: CampaignStore,
  jobId: string,
  monitor: ActiveMonitor,
): Promise<HeartbeatRecord> {
  const heartbeat = await readHeartbeat(store, jobId);
  if (heartbeat.status !== "running") {
    return heartbeat;
  }

  let outputBytes = monitor.lastStdoutBytes;
  try {
    const stdoutStat = await stat(monitor.stdoutPath);
    outputBytes = stdoutStat.size;
  } catch {
    outputBytes = monitor.lastStdoutBytes;
  }
  monitor.lastStdoutBytes = outputBytes;

  const registry = await SessionRegistry.open(store);
  await registry.update({ jobId });

  return writeHeartbeat(store, heartbeat, {
    status: "running",
    pid: heartbeat.pid,
  });
}

function processAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function finishMonitor(
  store: CampaignStore,
  record: DispatchRecord,
  terminalStatus: string,
  heartbeatStatus: HeartbeatRecord["status"],
): Promise<void> {
  const monitor = activeMonitors.get(record.jobId);
  if (monitor !== undefined) {
    if (!monitor.finished) {
      monitor.finished = true;
      clearInterval(monitor.heartbeatTimer);
      clearTimeout(monitor.timeoutTimer);
    }
    activeMonitors.delete(record.jobId);
  }

  const heartbeat = await readHeartbeat(store, record.jobId);
  if (heartbeat.status === "timeout" || heartbeat.status === "terminal") {
    return;
  }

  await writeHeartbeat(store, heartbeat, {
    status: heartbeatStatus,
    terminalStatus,
  });

  const registry = await SessionRegistry.open(store);
  await registry.update({ jobId: record.jobId, terminalStatus });
}

async function terminateRunner(pid: number, child?: ChildProcess): Promise<void> {
  if (child !== undefined) {
    child.kill("SIGTERM");
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  setTimeout(() => {
    if (child !== undefined) {
      child.kill("SIGKILL");
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }, 100).unref();
}

async function observeRunningJob(
  store: CampaignStore,
  record: DispatchRecord,
  monitor: ActiveMonitor,
): Promise<void> {
  const heartbeat = await readHeartbeat(store, record.jobId);
  if (heartbeat.status !== "running" || monitor.finished) {
    return;
  }

  if (!processAlive(monitor.pid)) {
    monitor.finished = true;
    clearInterval(monitor.heartbeatTimer);
    clearTimeout(monitor.timeoutTimer);
    activeMonitors.delete(record.jobId);
    await finishMonitor(store, record, "success", "terminal");
  }
}

async function startMonitor(
  store: CampaignStore,
  record: DispatchRecord,
  child?: ChildProcess,
  pid?: number,
): Promise<void> {
  if (activeMonitors.has(record.jobId)) {
    return;
  }

  const resolvedPid = pid ?? child?.pid;
  if (resolvedPid === undefined) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Detached monitor requires a PID");
  }

  const stdoutPath = path.join(record.artifactDir, "stdout.log");
  let stdoutBytes = 0;
  try {
    stdoutBytes = (await stat(stdoutPath)).size;
  } catch {
    stdoutBytes = 0;
  }

  const monitor: ActiveMonitor = {
    pid: resolvedPid,
    stdoutPath,
    lastStdoutBytes: stdoutBytes,
    finished: false,
    ...(child === undefined ? {} : { child }),
    heartbeatTimer: setInterval(() => {
      void touchHeartbeat(store, record.jobId, monitor)
        .then(() => observeRunningJob(store, record, monitor))
        .catch(() => undefined);
    }, record.heartbeatIntervalMs),
    timeoutTimer: setTimeout(() => {
      void (async () => {
        if (monitor.finished) {
          return;
        }
        monitor.finished = true;
        clearInterval(monitor.heartbeatTimer);
        await terminateRunner(monitor.pid, monitor.child);

        const heartbeat = await readHeartbeat(store, record.jobId);
        await writeHeartbeat(store, heartbeat, {
          status: "timeout",
          terminalStatus: "timeout",
        });
        const registry = await SessionRegistry.open(store);
        await registry.update({ jobId: record.jobId, terminalStatus: "timeout" });
        await pauseForRunnerTimeout(store, record.jobId);
        activeMonitors.delete(record.jobId);
      })().catch(() => undefined);
    }, record.timeoutMs),
  };

  activeMonitors.set(record.jobId, monitor);

  if (child !== undefined) {
    child.once("exit", () => {
      void (async () => {
        if (monitor.finished) {
          return;
        }
        monitor.finished = true;
        clearInterval(monitor.heartbeatTimer);
        clearTimeout(monitor.timeoutTimer);
        activeMonitors.delete(record.jobId);
        await finishMonitor(store, record, "success", "terminal");
      })().catch(() => undefined);
    });

    child.once("error", () => {
      void finishMonitor(store, record, "failure", "terminal").catch(() => undefined);
    });
  }
}

async function spawnDetachedRunner(record: DispatchRecord): Promise<ChildProcess> {
  const executable = record.argv[0];
  if (!executable) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Runner argv must include an executable");
  }

  await mkdir(record.artifactDir, { recursive: true, mode: 0o700 });
  const stdoutPath = path.join(record.artifactDir, "stdout.log");
  const stderrPath = path.join(record.artifactDir, "stderr.log");
  const stdoutHandle = await open(stdoutPath, "a", 0o600);
  const stderrHandle = await open(stderrPath, "a", 0o600);

  const child = spawn(executable, record.argv.slice(1), {
    detached: true,
    shell: false,
    stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
    env: {
      ...process.env,
      QUIRKS_FAKE_RUNNER_OUTDIR: record.artifactDir,
    },
  });

  stdoutHandle.close().catch(() => undefined);
  stderrHandle.close().catch(() => undefined);

  if (child.pid === undefined) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Detached runner did not return a PID");
  }

  return child;
}

async function dispatchDetachedJob(store: CampaignStore, input: StartDetachedJobInput): Promise<{ campaignId: string; jobId: string }> {
  const jobId = createJobId(input.jobId);
  const campaignId = store.campaignId;
  const artifactDir = path.join(store.artifactsPath, jobId);
  const sessionHandle = extractFlagValue(input.argv, "--session-id") ?? "";
  const artifactPaths = artifactPathsForJob(store, jobId);
  const record: DispatchRecord = {
    jobId,
    campaignId,
    profile: input.profile,
    argv: input.argv,
    timeoutMs: input.timeoutMs,
    cancelScope: input.cancelScope ?? "job",
    role: input.role ?? "implementer",
    sessionHandle,
    artifactDir,
    artifactPaths,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
  };

  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const initialHeartbeat: HeartbeatRecord = {
    schemaVersion: 1,
    jobId,
    campaignId,
    pid: 0,
    sessionHandle,
    startedAt,
    updatedAt: startedAt,
    revision: 0,
    status: "starting",
  };
  await writeJsonAtomic(heartbeatPath(store, jobId), initialHeartbeat);
  await writeDispatchRecord(store, record);

  const child = await spawnDetachedRunner(record);
  const pid = child.pid!;

  const registry = await SessionRegistry.open(store);
  await registry.register({
    jobId,
    role: record.role,
    profileId: input.profile.profileId,
    sessionHandle,
    pid,
    artifactPaths,
  });

  const runningHeartbeat = await writeHeartbeat(store, initialHeartbeat, {
    pid,
    status: "running",
  });

  const snapshot = await store.readState();
  await appendRunnerEvent(store, {
    schemaVersion: 1,
    id: `runner-dispatched:${jobId}`,
    type: "runner.dispatched",
    at: runningHeartbeat.updatedAt,
    actor: "watchdog",
    from: snapshot.status,
    to: snapshot.status,
    reason: "runner_dispatched",
    evidence: {
      jobId,
      sessionHandle,
      artifactPaths: artifactPaths.join(","),
      timeoutMs: String(input.timeoutMs),
      cancelScope: record.cancelScope,
      pid: String(pid),
    },
  });

  await startMonitor(store, record, child, pid);
  child.unref();

  return { campaignId, jobId };
}

export async function startDetachedJob(input: StartDetachedJobInput): Promise<{ campaignId: string; jobId: string }> {
  return dispatchDetachedJob(input.store, input);
}

export async function reattachWatchdog(store: CampaignStore, jobId: string): Promise<void> {
  const record = await readDispatchRecord(store, jobId);
  const heartbeat = await readHeartbeat(store, jobId);
  if (heartbeat.status === "terminal" || heartbeat.status === "timeout") {
    return;
  }

  if (activeMonitors.has(jobId)) {
    return;
  }

  if (!processAlive(heartbeat.pid)) {
    await finishMonitor(store, record, "failure", "terminal");
    return;
  }

  await startMonitor(store, record, undefined, heartbeat.pid);
}

export async function stopWatchdog(jobId?: string): Promise<void> {
  const targets = jobId === undefined ? [...activeMonitors.keys()] : [jobId];
  for (const activeJobId of targets) {
    const monitor = activeMonitors.get(activeJobId);
    if (monitor === undefined) {
      continue;
    }
    monitor.finished = true;
    clearInterval(monitor.heartbeatTimer);
    clearTimeout(monitor.timeoutTimer);
    await terminateRunner(monitor.pid, monitor.child);
    activeMonitors.delete(activeJobId);
  }
}

export async function probeLiveness(store: CampaignStore, jobId: string): Promise<LivenessReport> {
  const heartbeat = await readHeartbeat(store, jobId);
  const stdoutPath = path.join(store.artifactsPath, jobId, "stdout.log");
  let outputGrowing = false;
  try {
    const stdoutStat = await stat(stdoutPath);
    outputGrowing = stdoutStat.size > 0;
  } catch {
    outputGrowing = false;
  }

  return {
    pid: heartbeat.pid,
    sessionHandle: heartbeat.sessionHandle,
    outputGrowing,
    terminal: heartbeat.status === "terminal" || heartbeat.status === "timeout",
    lastHeartbeatAt: heartbeat.updatedAt,
  };
}
