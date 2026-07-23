import { hasDurableApproval } from "../campaign/approval.js";
import { CampaignStore } from "../campaign/store.js";
import type { StagingOutcome } from "../campaign/staging.js";
import type { CampaignEnvelope, CampaignEvent } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import { openWorkspace } from "../ui/open-workspace.js";
import type { ParsedCampaignArgs } from "./campaign-args.js";
import { runCampaignCommand, stateDirFor } from "./campaign-commands.js";
import { domainErrorCode, exitCodeForError, type ExitCode } from "./output.js";

/**
 * `quirks-campaign run`: the one-command campaign happy path.
 *
 * It composes the existing primitives - preflight (with replace-or-refuse
 * re-staging), the digest-bound approval path, and start (runToCompletion) -
 * into a single flow with exactly ONE operator decision. It never writes an
 * approval outside the existing approval paths: the inline decision goes
 * through the same challenge/consume pair as `approve`, and `--browser` waits
 * for the loopback workspace's durable approval record.
 */

export type ParsedCampaignRunArgs = Extract<ParsedCampaignArgs, { command: "run" }>;

export interface CampaignRunIo {
  out: (line: string) => void;
  err: (line: string) => void;
  isTty: boolean;
  /** Reads one line for the inline y/N decision. Absent means non-interactive. */
  question?: (prompt: string) => Promise<string>;
  /** Launches the browser for `--browser`; the platform default when absent. */
  openBrowser?: (url: string) => Promise<void>;
  /** Event/approval polling cadence; injectable for tests. */
  pollIntervalMs?: number;
  /** How long `--browser` waits for the durable approval before failing closed. */
  browserApprovalTimeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 250;
// Matches the approval-token lifetime: waiting longer can never succeed.
const DEFAULT_BROWSER_APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

interface PreflightPayload {
  ok: boolean;
  campaignId: string;
  envelope: CampaignEnvelope;
  blockers: string[];
  staging?: StagingOutcome;
}

interface StartPayload {
  ok: boolean;
  campaignId: string;
  claimedTaskIds: readonly string[];
  dispatchedJobs: readonly { jobId: string; taskId: string; role: string }[];
  outcome?: {
    status: "completed" | "paused" | "hold" | "stopped";
    completedJobs: readonly unknown[];
    pausedLanes: readonly string[];
    breaker?: { action: string; reason: string };
  };
}

type ApprovalDecision = "approved" | "declined" | "needs-interactive" | "browser-timeout";

function approveCommandFor(campaignId: string, digest: string): string {
  return `quirks-campaign approve --campaign ${campaignId} --digest ${digest}`;
}

function startCommandFor(campaignId: string): string {
  return `quirks-campaign start --campaign ${campaignId}`;
}

function statusCommandFor(campaignId: string): string {
  return `quirks-campaign status --campaign ${campaignId}`;
}

function runCommandLine(parsed: ParsedCampaignRunArgs, campaignIdOverride?: string): string {
  const parts = ["quirks-campaign run"];
  for (const taskId of parsed.taskIds) parts.push(`--task ${taskId}`);
  const campaignId = campaignIdOverride ?? parsed.campaignId;
  if (campaignId !== undefined) parts.push(`--campaign ${campaignId}`);
  if (parsed.externalRouting) parts.push("--external-routing");
  if (parsed.maxConcurrency !== undefined) parts.push(`--max-concurrency ${parsed.maxConcurrency}`);
  if (parsed.approval === "browser") parts.push("--browser");
  if (parsed.json) parts.push("--json");
  return parts.join(" ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openRunStore(campaignId: string): Promise<CampaignStore> {
  const context = await loadProjectContext(process.cwd(), { mode: "inspection" });
  return CampaignStore.open(stateDirFor(context.repositoryId), context.repositoryId, campaignId);
}

function printEnvelopeSummary(io: CampaignRunIo, envelope: CampaignEnvelope, staging: StagingOutcome | undefined): void {
  io.out(`Campaign ${envelope.campaignId} staged (${staging ?? "unchanged"}).`);
  if (staging === "replaced") {
    io.out("  note: the stale pre-approval envelope was replaced; approval binds to the new digest below.");
  }
  io.out(`  envelope digest: ${envelope.digest}`);
  io.out(`  tasks (${envelope.taskIds.length}): ${envelope.taskIds.join(", ")}`);
  for (const taskId of envelope.taskIds) {
    const routing = envelope.routing[taskId];
    if (!routing) continue;
    const reviewer = routing.fallbacks[0];
    io.out(
      `  route ${taskId}: implementer ${routing.primary.profileId} (tier ${routing.primary.tier})` +
        (reviewer ? `, reviewer ${reviewer.profileId} (tier ${reviewer.tier})` : ""),
    );
  }
  const budgets = envelope.budgets;
  io.out(
    `  budgets: maxConcurrency ${budgets.maxConcurrency}, maxTasks ${budgets.maxTasks}, ` +
      `maxRetries ${budgets.maxRetries}, maxWallClockMs ${budgets.maxWallClockMs}`,
  );
  io.out(`  git: base ${envelope.git.baseCommit} -> ${envelope.git.campaignBranch} (target ${envelope.git.targetBranch})`);
  io.out(`  external routing: ${envelope.externalRoutingEnabled ? "enabled" : "disabled"}`);
}

function formatEventLine(event: CampaignEvent): string {
  const evidence = event.evidence;
  switch (event.type) {
    case "wave.started":
      return `wave ${evidence["wave"]} started: ${evidence["taskIds"] || "(none)"}`;
    case "wave.completed":
      return `wave ${evidence["wave"]} completed: ${evidence["completedTaskIds"] || "(no tasks accepted)"}`;
    case "runner.dispatched":
      return `job dispatched: ${evidence["jobId"]} (profile ${evidence["profileId"]})`;
    case "lane.paused":
      return `breaker paused lane(s) ${evidence["lanes"]}: ${event.reason}`;
    case "campaign.paused":
      return `campaign paused: ${event.reason}`;
    case "campaign.hold":
      return `campaign hold: ${event.reason}`;
    case "lock.stolen":
      return `stale repository lock stolen (pid ${evidence["stalePid"]}, campaign ${evidence["staleCampaignId"]})`;
    case "integration.reset":
      return `integration branch ${evidence["branch"]} reset to the envelope base`;
    case "state.changed":
      return `state: ${event.from} -> ${event.to} (${event.reason})`;
    default:
      return `event ${event.type}: ${event.reason}`;
  }
}

function reportBlockers(parsed: ParsedCampaignRunArgs, io: CampaignRunIo, preflight: PreflightPayload): ExitCode {
  const rerun = runCommandLine(parsed);
  if (parsed.json) {
    io.out(JSON.stringify({
      ok: false,
      error: "PROTOCOL_VIOLATION",
      reason: "preflight_blockers",
      campaignId: preflight.campaignId,
      blockers: preflight.blockers,
      remediation: `Fix the blockers, then re-run: ${rerun}`,
      localCoordinationOnly: true,
    }));
    return 3;
  }
  io.err(`Campaign ${preflight.campaignId} preflight found ${preflight.blockers.length} blocker(s):`);
  for (const blocker of preflight.blockers) io.err(`  - ${blocker}`);
  io.err("Nothing was staged or approved.");
  io.err(`Fix the blockers above, then re-run: ${rerun}`);
  return 3;
}

async function waitForBrowserApproval(
  parsed: ParsedCampaignRunArgs,
  io: CampaignRunIo,
  store: CampaignStore,
  envelope: CampaignEnvelope,
): Promise<ApprovalDecision> {
  const timeoutMs = io.browserApprovalTimeoutMs ?? DEFAULT_BROWSER_APPROVAL_TIMEOUT_MS;
  const pollMs = io.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  // `--browser` is an explicit request to launch the workspace, so the deps
  // ask openWorkspace to perform the launch regardless of the local TTY.
  const workspace = await openWorkspace({
    campaignId: envelope.campaignId,
    ports: "production",
    deps: {
      json: false,
      isTty: true,
      ...(io.openBrowser ? { openBrowser: io.openBrowser } : {}),
    },
  });
  try {
    if (!parsed.json) {
      io.out(
        `Waiting up to ${Math.round(timeoutMs / 1000)}s for the browser approval of digest ${envelope.digest}...`,
      );
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await hasDurableApproval(store, envelope.digest)) {
        if (!parsed.json) io.out(`Browser approval recorded durably for digest ${envelope.digest}.`);
        return "approved";
      }
      if (Date.now() >= deadline) return "browser-timeout";
      await sleep(pollMs);
    }
  } finally {
    await workspace.close?.();
  }
}

async function resolveApproval(
  parsed: ParsedCampaignRunArgs,
  io: CampaignRunIo,
  store: CampaignStore,
  envelope: CampaignEnvelope,
): Promise<ApprovalDecision> {
  if (await hasDurableApproval(store, envelope.digest)) {
    if (!parsed.json) io.out(`Approval: already durably recorded for digest ${envelope.digest}.`);
    return "approved";
  }
  if (parsed.approval === "browser") return waitForBrowserApproval(parsed, io, store, envelope);
  if (parsed.json || !io.isTty || !io.question) return "needs-interactive";
  const answer = (
    await io.question(`Approve campaign ${envelope.campaignId} binding envelope digest ${envelope.digest}? [y/N] `)
  ).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") return "declined";
  // The REAL approval path: the exact challenge/consume pair `approve` uses.
  await runCampaignCommand({
    command: "approve",
    campaignId: envelope.campaignId,
    digest: envelope.digest,
    json: true,
  });
  io.out(`Approval recorded durably for digest ${envelope.digest}.`);
  return "approved";
}

function refuseApproval(
  parsed: ParsedCampaignRunArgs,
  io: CampaignRunIo,
  envelope: CampaignEnvelope,
  decision: Exclude<ApprovalDecision, "approved">,
): ExitCode {
  const campaignId = envelope.campaignId;
  const approveCommand = approveCommandFor(campaignId, envelope.digest);
  const startCommand = startCommandFor(campaignId);
  const reason =
    decision === "declined"
      ? "approval_declined"
      : decision === "browser-timeout"
        ? "browser_approval_timeout"
        : "interactive_approval_required";
  if (parsed.json) {
    io.out(JSON.stringify({
      ok: false,
      error: "PROTOCOL_VIOLATION",
      reason,
      campaignId,
      digest: envelope.digest,
      approveCommand,
      startCommand,
      localCoordinationOnly: true,
    }));
    return 3;
  }
  if (decision === "declined") {
    io.err(`Approval declined; campaign ${campaignId} stays awaiting approval.`);
  } else if (decision === "browser-timeout") {
    io.err(`No browser approval arrived in time; campaign ${campaignId} stays awaiting approval.`);
  } else {
    io.err("Refusing to approve without an interactive decision (non-interactive session).");
  }
  io.err(`Approve with: ${approveCommand}`);
  io.err(`Then start with: ${startCommand}`);
  if (decision === "needs-interactive") {
    io.err(`Or re-run in an interactive terminal (or with --browser): ${runCommandLine(parsed)}`);
  }
  return 3;
}

async function startAndStream(
  parsed: ParsedCampaignRunArgs,
  io: CampaignRunIo,
  store: CampaignStore,
  envelope: CampaignEnvelope,
  staging: StagingOutcome | undefined,
): Promise<ExitCode> {
  const campaignId = envelope.campaignId;
  const pollMs = io.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let offset = (await store.readEvents()).length;
  if (!parsed.json) io.out(`Starting campaign ${campaignId}...`);

  const flush = async (): Promise<void> => {
    const events = await store.readEvents();
    if (!parsed.json) {
      for (const event of events.slice(offset)) io.out(`  ${formatEventLine(event)}`);
    }
    offset = events.length;
  };

  // The guarded promise never rejects, so racing it against the poll tick
  // cannot leak an unhandled rejection while the stream loop sleeps.
  const guardedStart = runCampaignCommand({ command: "start", campaignId, singleWave: false, json: true }).then(
    (value) => ({ ok: true as const, value: value as StartPayload }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  for (;;) {
    const winner = await Promise.race([
      guardedStart.then(() => "settled" as const),
      sleep(pollMs).then(() => "tick" as const),
    ]);
    await flush();
    if (winner === "settled") break;
  }
  const result = await guardedStart;
  if (!result.ok) throw result.error;

  const start = result.value;
  const outcomeStatus = start.outcome?.status ?? "completed";
  let reason = start.outcome?.breaker?.reason;
  if ((outcomeStatus === "paused" || outcomeStatus === "hold") && reason === undefined) {
    try {
      const state = await store.readState();
      reason = state.pausedReason ?? state.blockedReason;
    } catch {
      // The journal already streamed the pause event; a state read failure
      // must not mask a finished run.
    }
  }
  const nextCommands =
    outcomeStatus === "paused"
      ? [`Next: quirks-campaign resume --campaign ${campaignId}`, `Then: ${startCommandFor(campaignId)}`]
      : [`Next: ${statusCommandFor(campaignId)}`];

  if (parsed.json) {
    io.out(JSON.stringify({
      ok: true,
      campaignId,
      digest: envelope.digest,
      ...(staging ? { staging } : {}),
      claimedTaskIds: start.claimedTaskIds,
      dispatchedJobs: start.dispatchedJobs,
      outcome: start.outcome,
      nextCommand: outcomeStatus === "paused"
        ? `quirks-campaign resume --campaign ${campaignId}`
        : statusCommandFor(campaignId),
      localCoordinationOnly: true,
    }));
    return 0;
  }

  if (outcomeStatus === "completed") {
    io.out(
      `Outcome: completed. ${start.claimedTaskIds.length} task(s) accepted across ` +
        `${start.dispatchedJobs.length} runner job(s).`,
    );
  } else {
    io.out(`Outcome: ${outcomeStatus}${reason ? ` (${reason})` : ""}.`);
  }
  for (const line of nextCommands) io.out(line);
  return 0;
}

function recoverySteps(
  parsed: ParsedCampaignRunArgs,
  error: unknown,
  campaignId: string | undefined,
  storedDigest: string | undefined,
): string[] {
  const message = error instanceof Error ? error.message : "";
  const details = error instanceof QuirksError ? error.details : {};
  const digest = details["storedDigest"] ?? storedDigest;
  if (message.includes("ENVELOPE_REPLACE_REFUSED")) {
    // The stored campaign already ran approved work; the same closure needs a
    // fresh campaign identity.
    return [runCommandLine(parsed, "<new-id>")];
  }
  if (campaignId !== undefined && digest !== undefined &&
    (message.includes("DIGEST_MISMATCH") || message.includes("APPROVAL_REQUIRED"))) {
    return [approveCommandFor(campaignId, digest), startCommandFor(campaignId)];
  }
  if (message.includes("INTEGRATION_BRANCH_MISMATCH")) {
    // The error message itself names the exact `git branch -f` fix; after it,
    // the run command is safe to repeat.
    return [runCommandLine(parsed)];
  }
  if (campaignId !== undefined) return [statusCommandFor(campaignId)];
  return [runCommandLine(parsed)];
}

function reportFailure(
  parsed: ParsedCampaignRunArgs,
  io: CampaignRunIo,
  error: unknown,
  campaignId: string | undefined,
  storedDigest: string | undefined,
): ExitCode {
  const message = error instanceof Error ? error.message : "Unexpected failure";
  const recovery = recoverySteps(parsed, error, campaignId, storedDigest);
  if (parsed.json) {
    io.out(JSON.stringify({
      ok: false,
      error: domainErrorCode(error),
      message,
      recovery,
      localCoordinationOnly: true,
    }));
  } else {
    io.err(message);
    for (const step of recovery) io.err(`Recovery: ${step}`);
  }
  return exitCodeForError(error);
}

export async function runCampaignRun(parsed: ParsedCampaignRunArgs, io: CampaignRunIo): Promise<ExitCode> {
  let campaignId: string | undefined = parsed.campaignId;
  let storedDigest: string | undefined;
  try {
    // 1. Preflight and stage. Staging safely replaces a stale pre-approval
    //    envelope (journaled as envelope.replaced) or refuses loudly.
    const preflight = (await runCampaignCommand({
      command: "preflight",
      taskIds: [...parsed.taskIds],
      ...(parsed.campaignId !== undefined ? { campaignId: parsed.campaignId } : {}),
      externalRouting: parsed.externalRouting,
      ...(parsed.maxConcurrency !== undefined ? { maxConcurrency: parsed.maxConcurrency } : {}),
      json: true,
    })) as PreflightPayload;
    campaignId = preflight.campaignId;
    if (!preflight.ok) return reportBlockers(parsed, io, preflight);

    // 2. The STORED envelope is what approval binds to: read it back rather
    //    than trusting the in-memory preflight result.
    const store = await openRunStore(preflight.campaignId);
    const envelope = await store.readEnvelope();
    storedDigest = envelope.digest;
    if (!parsed.json) printEnvelopeSummary(io, envelope, preflight.staging);

    // 3. ONE decision, always digest-bound, never bypassing the approval model.
    const decision = await resolveApproval(parsed, io, store, envelope);
    if (decision !== "approved") return refuseApproval(parsed, io, envelope, decision);

    // 4. Start (runToCompletion) while streaming journal events, then report
    //    the outcome with the exact next command.
    return await startAndStream(parsed, io, store, envelope, preflight.staging);
  } catch (error) {
    return reportFailure(parsed, io, error, campaignId, storedDigest);
  }
}
