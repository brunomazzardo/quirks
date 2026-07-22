import path from "node:path";
import { recoverCampaignOrThrow } from "../campaign/recovery.js";
import { runPreflight } from "../campaign/preflight.js";
import { createCampaignRuntime, lockPathFor } from "../campaign/runtime-context.js";
import { CampaignSupervisor } from "../campaign/supervisor.js";
import { CampaignStore } from "../campaign/store.js";
import type { CampaignEnvelope, CampaignSnapshot } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import { reattachWatchdog, stopWatchdog } from "../runner/watchdog.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { SyncOutbox } from "../sync/outbox.js";
import { createTaskSource } from "../task-source/factory.js";
import { disposeTaskSource } from "../task-source/task-source.js";
import type { ParsedCampaignArgs } from "./campaign-args.js";
import { consumeApprovalToken, createApprovalChallenge, hasDurableApproval } from "../campaign/approval.js";

function stateDirFor(repositoryId: string): string {
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
  const runtime = await createCampaignRuntime(envelope, repositoryRoot, { mode: "real" });
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

async function persistPreflightStore(envelope: CampaignEnvelope): Promise<CampaignStore> {
  const stateDir = stateDirFor(envelope.repositoryId);
  try {
    return await CampaignStore.create({
      stateDir,
      repositoryId: envelope.repositoryId,
      campaignId: envelope.campaignId,
      envelope,
    });
  } catch (error) {
    if (error instanceof QuirksError && error.message.includes("already exists")) {
      return CampaignStore.open(stateDir, envelope.repositoryId, envelope.campaignId);
    }
    throw error;
  }
}

export async function runCampaignCommand(parsed: ParsedCampaignArgs): Promise<unknown> {
  switch (parsed.command) {
    case "preflight": {
      const repositoryRoot = await resolveRepositoryRoot(parsed.configPath);
      const result = await runPreflight({
        repositoryRoot,
        selectedTaskIds: parsed.taskIds,
        externalRoutingEnabled: parsed.externalRouting,
        ...(parsed.configPath ? {} : {}),
      });
      if (result.blockers.length === 0) {
        await persistPreflightStore(result.envelope);
      }
      return {
        ok: result.blockers.length === 0,
        campaignId: result.envelope.campaignId,
        envelope: result.envelope,
        blockers: result.blockers,
        proposal: result.proposal,
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
      return { ok: true, campaignId: parsed.campaignId, approval, localCoordinationOnly: true };
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
        await supervisor.startApproved();
        const status = await supervisor.status();
        await supervisor.stop();
        return {
          ok: true,
          campaignId: parsed.campaignId,
          claimedTaskIds: status.claimedTaskIds,
          dispatchedJobs: status.dispatchedJobs,
          localCoordinationOnly: true,
        };
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
