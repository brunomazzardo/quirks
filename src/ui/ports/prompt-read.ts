import { QuirksError } from "../../core/errors.js";
import {
  briefTaskProjection,
  resolveTaskPlanOutline,
  taskFactsFromShow,
  type NormalizedTaskRecord,
} from "../../campaign/task-brief.js";
import { assemblePromptContext, type CampaignPromptProjection } from "../../prompt/context.js";
import type { PromptContext, PromptContextKind } from "../../prompt/types.js";
import type { RunnerProfile } from "../../runner/types.js";
import type { TaskSource } from "../../task-source/task-source.js";

export interface PromptReadRequest {
  contextKind: PromptContextKind;
  campaignId?: string;
  taskId?: string;
}

/**
 * Authority adapter that assembles a bounded {@link PromptContext} for one
 * request through existing read models and ports. It never opens canonical
 * task files or credentials directly; missing data stays missing.
 */
export interface PromptReadPort {
  getContext(request: PromptReadRequest): Promise<PromptContext>;
}

export interface CampaignPromptFacts extends CampaignPromptProjection {
  baseCommit?: string;
  implementerProfileId?: string;
}

export interface CreatePromptReadPortInput {
  repositoryId: string;
  repositoryRoot: string;
  source: TaskSource;
  skills: Readonly<Record<string, string>>;
  profiles: readonly RunnerProfile[];
  /** Durable campaign facts; absent means campaign authority is missing and campaign contexts fail closed. */
  campaign?: (campaignId?: string) => Promise<CampaignPromptFacts | undefined>;
  /** Validated candidate commit for a task under review, when one exists. */
  candidateCommit?: (taskId: string) => Promise<string | undefined>;
}

async function loadCampaignFacts(
  input: CreatePromptReadPortInput,
  requestedCampaignId: string | undefined,
): Promise<CampaignPromptFacts | undefined> {
  const facts = await input.campaign?.(requestedCampaignId);
  if (!facts) return undefined;
  if (requestedCampaignId !== undefined && facts.campaignId !== requestedCampaignId) {
    throw new QuirksError(
      "PROTOCOL_VIOLATION",
      `Campaign authority is contradictory: requested ${requestedCampaignId}, resolved ${facts.campaignId}`,
    );
  }
  return facts;
}

/**
 * Production prompt read port over the real TaskSource and durable campaign
 * state. Missing required authority fails closed with a protocol error — it
 * is never substituted with a generic context.
 */
export function createPromptReadPort(input: CreatePromptReadPortInput): PromptReadPort {
  return {
    async getContext(request: PromptReadRequest): Promise<PromptContext> {
      const wantsTask = request.contextKind === "task" || request.contextKind === "review";
      if (wantsTask && !request.taskId) {
        throw new QuirksError("PROTOCOL_VIOLATION", `A ${request.contextKind} prompt context requires a taskId`);
      }
      if (!wantsTask && !request.campaignId) {
        throw new QuirksError("PROTOCOL_VIOLATION", `A ${request.contextKind} prompt context requires a campaignId`);
      }

      const campaign = await loadCampaignFacts(input, request.campaignId);
      if (!wantsTask && !campaign) {
        throw new QuirksError(
          "PROTOCOL_VIOLATION",
          `No durable campaign authority is available for ${request.campaignId}`,
        );
      }

      let task;
      let plan;
      let git;
      if (wantsTask) {
        const taskId = request.taskId!;
        const shown = await input.source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
        if (!shown.ok) {
          throw new QuirksError("PROTOCOL_VIOLATION", `Cannot show task ${taskId}: ${shown.error.message}`);
        }
        if (!shown.nativeRevision) {
          throw new QuirksError("PROTOCOL_VIOLATION", `Task source did not return a revision for ${taskId}`);
        }
        const facts = taskFactsFromShow(taskId, shown.data as NormalizedTaskRecord, shown.nativeRevision);
        task = briefTaskProjection(facts);
        plan = await resolveTaskPlanOutline(input.repositoryRoot, facts);
        if (campaign?.baseCommit !== undefined) {
          const candidate = await input.candidateCommit?.(taskId);
          git = {
            baseCommit: campaign.baseCommit,
            ...(candidate !== undefined ? { candidateCommit: candidate } : {}),
          };
        }
      }

      return assemblePromptContext({
        contextKind: request.contextKind,
        repositoryId: input.repositoryId,
        ...(task ? { task } : {}),
        ...(plan ? { plan } : {}),
        ...(campaign
          ? {
              campaign: {
                campaignId: campaign.campaignId,
                state: campaign.state,
                approved: campaign.approved,
                envelopeDigest: campaign.envelopeDigest,
              },
            }
          : {}),
        ...(git ? { git } : {}),
        skills: input.skills,
        profiles: input.profiles,
        ...(campaign?.implementerProfileId !== undefined
          ? { implementerProfileId: campaign.implementerProfileId }
          : {}),
      });
    },
  };
}
