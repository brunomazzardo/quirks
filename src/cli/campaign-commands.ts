import { readdir } from "node:fs/promises";
import path from "node:path";
import { recoverCampaignOrThrow } from "../campaign/recovery.js";
import { runPreflight } from "../campaign/preflight.js";
import { createCampaignRuntime, lockPathFor } from "../campaign/runtime-context.js";
import { isTerminalCampaignStatus } from "../campaign/state-machine.js";
import { stageCampaignEnvelope, type StagingOutcome } from "../campaign/staging.js";
import { CampaignSupervisor } from "../campaign/supervisor.js";
import { CampaignStore } from "../campaign/store.js";
import type { CampaignEnvelope, CampaignSnapshot, CampaignStatus } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import { reattachWatchdog, stopWatchdog } from "../runner/watchdog.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { SyncOutbox } from "../sync/outbox.js";
import { createTaskSource } from "../task-source/factory.js";
import { disposeTaskSource } from "../task-source/task-source.js";
import type { ParsedCampaignArgs } from "./campaign-args.js";
import { consumeApprovalToken, createApprovalChallenge, hasDurableApproval } from "../campaign/approval.js";

export function stateDirFor(repositoryId: string): string {
  return process.env.QUIRKS_STATE_DIR ?? resolveAppPaths(repositoryId).root;
}

async function resolveRepositoryRoot(configPath?: string): Promise<string> {
  if (configPath) return path.resolve(path.dirname(configPath));
  return process.cwd();
}

async function openStore(campaignId: string, repositoryRoot: string, configPath?: string): Promise<{
  store: CampaignStore;
  repositoryRoot: string;
  repositoryId: string;
}> {
  const root = configPath ? path.resolve(path.dirname(configPath)) : repositoryRoot;
  const context = await loadProjectContext(root, {
    mode: "inspection",
    ...(configPath ? { configPath } : {}),
  });
  const store = await CampaignStore.open(stateDirFor(context.repositoryId), context.repositoryId, campaignId);
  return { store, repositoryRoot: root, repositoryId: context.repositoryId };
}

async function supervisorContext(store: CampaignStore, repositoryRoot: string) {
  const envelope = await store.readEnvelope();
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const source = await createTaskSource(context);
  const outbox = SyncOutbox.open(store.syncOutboxFile);
  // A stale integration branch from a failed start is disposable only while
  // the campaign has never dispatched a job; afterwards it may carry real
  // work and a mismatch must stay a hard, remediation-carrying error.
  const state = await store.readState();
  const hasDispatchedJobs = (await store.readEvents()).some((event) => event.type === "runner.dispatched");
  const runtime = await createCampaignRuntime(envelope, repositoryRoot, {
    mode: "real",
    integrationRecovery: {
      resetOnMismatch: !hasDispatchedJobs,
      onReset: async ({ branch, fromCommit, toCommit }) => {
        const at = new Date().toISOString();
        await store.appendEvent({
          schemaVersion: 1,
          id: `integration:reset:${at}`,
          type: "integration.reset",
          at,
          actor: "control-plane",
          from: state.status,
          to: state.status,
          reason: "stale_integration_branch_reset",
          evidence: { branch, fromCommit, toCommit },
        });
      },
    },
  });
  return {
    store,
    source,
    outbox,
    runner: runtime.runner,
    worktree: runtime.worktree,
    profileIndex: runtime.profiles,
    workflowSkills: context.config.workflowPolicy.skills,
    lockPath: lockPathFor(envelope.repositoryId),
    repositoryRoot,
    envelope,
  };
}

async function persistPreflightStore(envelope: CampaignEnvelope): Promise<StagingOutcome> {
  const { outcome } = await stageCampaignEnvelope({
    stateDir: stateDirFor(envelope.repositoryId),
    envelope,
  });
  return outcome;
}

type ResumeCandidatePayload =
  | {
      ok: true;
      available: true;
      campaign: { id: string; status: CampaignStatus; lastEvent: { type: string; at: string } | null };
    }
  | { ok: true; available: false; reason: "no_resumable_campaign" };

// Read-only scan of the workspace repository's campaign store. A campaign is a
// resume candidate while its status still has an outgoing transition in the
// campaign state machine (see isTerminalCampaignStatus: `hold`, `complete`,
// and `cancelled` are terminal). Picks the most recently updated candidate,
// tie-broken by ascending campaign id; invalid or foreign store directories
// are skipped rather than failing the scan.
async function resumeCandidatePayload(): Promise<ResumeCandidatePayload> {
  const context = await loadProjectContext(process.cwd(), { mode: "inspection" });
  const stateDir = stateDirFor(context.repositoryId);
  const campaignsRoot = path.join(
    stateDir,
    "repositories",
    context.repositoryId.replaceAll(":", "-"),
    "campaigns",
  );
  let campaignIds: string[];
  try {
    campaignIds = await readdir(campaignsRoot);
  } catch {
    campaignIds = [];
  }

  const candidates: {
    id: string;
    status: CampaignStatus;
    updatedAt: string;
    lastEvent: { type: string; at: string } | null;
  }[] = [];
  for (const campaignId of campaignIds) {
    try {
      const store = await CampaignStore.open(stateDir, context.repositoryId, campaignId);
      const state = await store.readState();
      if (isTerminalCampaignStatus(state.status)) continue;
      const lastEvent = (await store.readEvents()).at(-1);
      candidates.push({
        id: campaignId,
        status: state.status,
        updatedAt: state.updatedAt,
        lastEvent: lastEvent ? { type: lastEvent.type, at: lastEvent.at } : null,
      });
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) {
    return { ok: true, available: false, reason: "no_resumable_campaign" };
  }
  candidates.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const chosen = candidates[0]!;
  return {
    ok: true,
    available: true,
    campaign: { id: chosen.id, status: chosen.status, lastEvent: chosen.lastEvent },
  };
}

export async function runCampaignCommand(parsed: ParsedCampaignArgs): Promise<unknown> {
  switch (parsed.command) {
    case "preflight": {
      const repositoryRoot = await resolveRepositoryRoot(parsed.configPath);
      const result = await runPreflight({
        repositoryRoot,
        selectedTaskIds: parsed.taskIds,
        externalRoutingEnabled: parsed.externalRouting,
        ...(parsed.campaignId ? { campaignId: parsed.campaignId } : {}),
        ...(parsed.maxConcurrency !== undefined ? { maxConcurrency: parsed.maxConcurrency } : {}),
        ...(parsed.configPath ? {} : {}),
      });
      let staging: StagingOutcome | undefined;
      if (result.blockers.length === 0) {
        staging = await persistPreflightStore(result.envelope);
      }
      return {
        ok: result.blockers.length === 0,
        campaignId: result.envelope.campaignId,
        envelope: result.envelope,
        blockers: result.blockers,
        proposal: result.proposal,
        ...(staging ? { staging } : {}),
        localCoordinationOnly: true,
      };
    }
    case "approve": {
      const { store } = await openStore(parsed.campaignId, process.cwd());
      const challenge = createApprovalChallenge({
        campaignId: parsed.campaignId,
        digest: parsed.digest,
      });
      const approval = await consumeApprovalToken({
        store,
        token: challenge.token,
        campaignId: parsed.campaignId,
        digest: parsed.digest,
        operator: { kind: "self-asserted", id: "quirks-campaign-cli" },
      });
      // An approval minted by an earlier token means this call was an
      // idempotent retry of an already-durably-approved digest.
      const alreadyApproved = approval.tokenId !== challenge.tokenId;
      return {
        ok: true,
        campaignId: parsed.campaignId,
        approval,
        ...(alreadyApproved ? { note: "already-approved" } : {}),
        localCoordinationOnly: true,
      };
    }
    case "start": {
      const { store, repositoryRoot } = await openStore(parsed.campaignId, process.cwd());
      const envelope = await store.readEnvelope();
      if (!(await hasDurableApproval(store, envelope.digest))) {
        throw new QuirksError("PROTOCOL_VIOLATION", "APPROVAL_REQUIRED");
      }
      const ctx = await supervisorContext(store, repositoryRoot);
      try {
        const supervisor = await CampaignSupervisor.open(ctx);
        try {
          if (parsed.singleWave) {
            await supervisor.startApproved();
            const status = await supervisor.status();
            return {
              ok: true,
              campaignId: parsed.campaignId,
              claimedTaskIds: status.claimedTaskIds,
              dispatchedJobs: status.dispatchedJobs,
              localCoordinationOnly: true,
            };
          }
          const outcome = await supervisor.runToCompletion();
          const status = await supervisor.status();
          return {
            ok: true,
            campaignId: parsed.campaignId,
            claimedTaskIds: status.claimedTaskIds,
            dispatchedJobs: status.dispatchedJobs,
            outcome,
            localCoordinationOnly: true,
          };
        } finally {
          // Release the repository lock on success and on every failure path
          // alike; a failed start must be immediately retryable.
          await supervisor.stop();
        }
      } finally {
        await disposeTaskSource(ctx.source);
      }
    }
    case "status": {
      const { store } = await openStore(parsed.campaignId, process.cwd());
      const state = await store.readState();
      const envelope = await store.readEnvelope();
      const sessions = await store.readSessionsDocument();
      const events = await store.readEvents();
      const approvals = await store.readApprovals();
      return {
        ok: true,
        campaignId: parsed.campaignId,
        status: state.status,
        digest: state.digest,
        envelopeDigest: envelope.digest,
        activeLanes: state.activeLanes ?? [],
        sessions: sessions.sessions,
        eventCount: events.length,
        approvalCount: approvals.length,
        localCoordinationOnly: true,
      };
    }
    case "attach": {
      const { store } = await openStore(parsed.campaignId, process.cwd());
      const sessions = await store.readSessionsDocument();
      const active = sessions.sessions.filter((session) => session.terminalStatus === undefined);
      const attached: string[] = [];
      for (const session of active) {
        try {
          await reattachWatchdog(store, session.jobId);
          attached.push(session.jobId);
        } catch {
          // Skip jobs without durable watchdog metadata.
        }
      }
      return { ok: true, campaignId: parsed.campaignId, attachedJobIds: attached, localCoordinationOnly: true };
    }
    case "resume-candidate":
      return resumeCandidatePayload();
    case "resume": {
      const { store } = await openStore(parsed.campaignId, process.cwd());
      const report = await recoverCampaignOrThrow(store);
      return {
        ok: true,
        campaignId: parsed.campaignId,
        state: report.state.status,
        recoveredJobs: report.recoveredJobs,
        duplicateDispatchesPrevented: report.duplicateDispatchesPrevented,
        pauseReason: report.pauseReason,
        localCoordinationOnly: true,
      };
    }
    case "cancel": {
      const { store } = await openStore(parsed.campaignId, process.cwd());
      const prior = await store.readState();
      if (parsed.scope) {
        await stopWatchdog(parsed.scope);
      } else {
        await stopWatchdog();
      }
      const now = new Date().toISOString();
      const next: CampaignSnapshot = {
        schemaVersion: 1,
        campaignId: parsed.campaignId,
        status: "cancelled",
        digest: prior.digest,
        updatedAt: now,
      };
      await store.writeState(next);
      await store.appendEvent({
        schemaVersion: 1,
        id: `cancel:${now}`,
        type: "state.changed",
        at: now,
        actor: "control-plane",
        from: prior.status,
        to: "cancelled",
        reason: parsed.scope ? `cancel_job:${parsed.scope}` : "operator_cancelled",
        evidence: parsed.scope ? { jobId: parsed.scope } : {},
      });
      return {
        ok: true,
        campaignId: parsed.campaignId,
        status: "cancelled",
        scope: parsed.scope ?? "campaign",
        localCoordinationOnly: true,
      };
    }
    default:
      throw new QuirksError("PROTOCOL_VIOLATION", `Unsupported campaign command ${(parsed as { command: string }).command}`);
  }
}
