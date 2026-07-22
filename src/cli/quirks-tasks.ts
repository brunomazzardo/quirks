#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import { loadProjectContext } from "../project/config.js";
import { createTaskSource } from "../task-source/factory.js";
import { validateSchema } from "../schema/validate.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { SyncOutbox } from "../sync/outbox.js";
import { reconcileMutation, reconcilePending } from "../sync/reconciler.js";
import { disposeTaskSource, type TaskSource } from "../task-source/task-source.js";
import type { MutationRequest, TaskSourceCapabilities, TaskSourceResponse } from "../task-source/types.js";
import { CliParseError, isMutationCommand, parseArgs } from "./args.js";
import { readMutationRequest } from "./mutation-request.js";
import {
  exitCodeForError,
  formatFreshness,
  localCoordinationLine,
  quirksErrorCodeFromString,
  writeHuman,
  writeJson,
} from "./output.js";

async function openOutbox(repositoryId: string): Promise<SyncOutbox> {
  const appPaths = resolveAppPaths(repositoryId);
  return SyncOutbox.open(path.join(appPaths.repository, "sync-outbox.jsonl"));
}

const NEW_TASK_REVISION = `sha256:${"0".repeat(64)}`;

async function readProposalTask(root: string, relativePath: string): Promise<unknown> {
  const normalized = assertRepositoryRelativePath(relativePath);
  const rootReal = await realpath(root);
  const fileReal = await realpath(path.join(root, normalized));
  const relative = path.relative(rootReal, fileReal);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Task proposal file escapes the repository");
  }
  try {
    return JSON.parse(await readFile(fileReal, "utf8")) as unknown;
  } catch {
    throw new QuirksError("SCHEMA_INVALID", "Task proposal file is not valid JSON");
  }
}

async function readCapabilities(source: TaskSource): Promise<TaskSourceCapabilities> {
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  if (!response.ok || response.operation !== "capabilities") {
    throw new QuirksError("SOURCE_UNAVAILABLE", "Task source capabilities are unavailable");
  }
  return validateSchema<TaskSourceCapabilities>("task-source-capabilities-v1", response.data);
}

function assertOkResponse<O extends TaskSourceResponse["operation"]>(
  response: TaskSourceResponse,
  operation: O,
): Extract<TaskSourceResponse, { operation: O; ok: true }> {
  if (!response.ok) {
    throw new QuirksError(quirksErrorCodeFromString(response.error.code), response.error.message);
  }
  if (response.operation !== operation) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Unexpected operation ${response.operation}`);
  }
  return response as Extract<TaskSourceResponse, { operation: O; ok: true }>;
}

async function syncCounts(outbox: SyncOutbox): Promise<{ pending: number; conflicts: number }> {
  const intents = await outbox.listAll();
  return {
    pending: intents.filter((intent) => intent.state === "pending").length,
    conflicts: intents.filter((intent) => intent.state === "conflict").length,
  };
}

async function reconcileAll(outbox: SyncOutbox, source: TaskSource): Promise<void> {
  const campaignIds = [...new Set((await outbox.listAll()).map((intent) => intent.campaignId))];
  for (const campaignId of campaignIds) {
    await reconcilePending({ campaignId, outbox, source });
  }
}

function campaignIdFromMutation(request: MutationRequest): string {
  if ("campaignId" in request.input && typeof request.input.campaignId === "string") {
    return request.input.campaignId;
  }
  const [campaignId] = request.idempotencyKey.split(":");
  if (!campaignId) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Mutation idempotency key must include campaign identity");
  }
  return campaignId;
}

function compactMutationResult(intent: Awaited<ReturnType<typeof reconcileMutation>>) {
  const acknowledgement = intent.acknowledgement;
  const nativeRevision = acknowledgement?.ok ? acknowledgement.nativeRevision : undefined;
  return {
    state: intent.state,
    operation: intent.operation,
    taskId: intent.taskId,
    ...(nativeRevision ? { nativeRevision } : {}),
  };
}

function withSource<T extends Record<string, unknown>>(
  driver: string,
  task: T,
): T & { source: { driver: string; nativeId: string; webUrl: null } } {
  return {
    ...task,
    source: {
      driver,
      nativeId: String(task.id),
      webUrl: null,
    },
  };
}

const PRIORITY_ORDER = ["P0", "P1", "P2", "P3"] as const;

function priorityRank(priority: string): number {
  const rank = PRIORITY_ORDER.indexOf(priority as (typeof PRIORITY_ORDER)[number]);
  return rank === -1 ? PRIORITY_ORDER.length : rank;
}

type ClaimCandidatePayload =
  | { ok: true; available: true; task: { id: string; title: string; status: string; dependsOnSatisfied: true } }
  | { ok: true; available: false; reason: "no_ready_tasks" | "pending_sync" };

// Read-only claim candidate selection: no mutation, no request file, no lock.
// Highest priority (P0 > P1 > P2 > P3) among `ready` tasks whose dependsOn are
// all `completed`; deterministic ascending-id tie-break.
async function claimCandidatePayload(source: TaskSource, pending: number): Promise<ClaimCandidatePayload> {
  if (pending > 0) {
    return { ok: true, available: false, reason: "pending_sync" };
  }
  const listResponse = assertOkResponse(
    await source.execute({ schemaVersion: 1, operation: "list", input: {} }),
    "list",
  );
  const summaries = (listResponse.data as { tasks: { id: string; status: string }[] }).tasks;
  const statusById = new Map(summaries.map((task) => [task.id, task.status]));
  const readyIds = summaries
    .filter((task) => task.status === "ready")
    .map((task) => task.id)
    .toSorted();

  let candidate: { id: string; title: string; status: string; priority: string } | undefined;
  for (const taskId of readyIds) {
    const showResponse = assertOkResponse(
      await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} }),
      "show",
    );
    const task = showResponse.data as {
      id: string;
      title: string;
      status: string;
      priority?: string;
      dependsOn?: string[];
    };
    const dependsOn = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    if (!dependsOn.every((dependency) => statusById.get(dependency) === "completed")) continue;
    const next = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: typeof task.priority === "string" ? task.priority : "P3",
    };
    if (!candidate || priorityRank(next.priority) < priorityRank(candidate.priority)) {
      candidate = next;
    }
  }

  if (!candidate) {
    return { ok: true, available: false, reason: "no_ready_tasks" };
  }
  return {
    ok: true,
    available: true,
    task: { id: candidate.id, title: candidate.title, status: candidate.status, dependsOnSatisfied: true },
  };
}

async function run(): Promise<number> {
  let json = false;
  let source: TaskSource | undefined;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    json = parsed.json;

    const context = await loadProjectContext(process.cwd(), {
      mode: "inspection",
      ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
    });
    source = await createTaskSource(context);
    const capabilities = await readCapabilities(source);
    const driver = capabilities.driver;
    const outbox = await openOutbox(context.repositoryId);
    const syncedAt = formatFreshness(new Date().toISOString());
    const counts = await syncCounts(outbox);

    if (parsed.command === "propose" && parsed.taskFile !== undefined) {
      assertOkResponse(await source.execute({ schemaVersion: 1, operation: "validate", input: {} }), "validate");
      const response = assertOkResponse(await source.execute({
        schemaVersion: 1,
        operation: "propose",
        taskId: parsed.taskId!,
        expectedNativeRevision: NEW_TASK_REVISION,
        idempotencyKey: parsed.idempotencyKey!,
        input: { task: await readProposalTask(context.root, parsed.taskFile) },
      }), "propose");
      const task = withSource(driver, response.data as Record<string, unknown>);
      const payload = { ok: true as const, driver, task, nativeRevision: response.nativeRevision };
      if (json) {
        writeJson(process.stdout, payload);
      } else {
        writeHuman(process.stdout, [
          `driver: ${driver}`,
          ...(localCoordinationLine(driver) ? [localCoordinationLine(driver)!] : []),
          `${task.id}\t${task.status}\t${task.title}`,
        ]);
      }
      return 0;
    }

    if (parsed.command === "claim-candidate") {
      const payload = await claimCandidatePayload(source, counts.pending);
      if (json) {
        writeJson(process.stdout, payload);
      } else {
        writeHuman(process.stdout, [
          `driver: ${driver}`,
          ...(localCoordinationLine(driver) ? [localCoordinationLine(driver)!] : []),
          `available: ${payload.available}`,
          ...(payload.available
            ? [`${payload.task.id}\t${payload.task.status}\t${payload.task.title}`]
            : [`reason: ${payload.reason}`]),
        ]);
      }
      return 0;
    }

    if (isMutationCommand(parsed.command)) {
      if (!capabilities.operations.includes(parsed.command)) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Task source does not support ${parsed.command}`);
      }
      const request = await readMutationRequest(
        context.root,
        parsed.requestFile!,
        parsed.command,
        capabilities.maxRequestBytes,
      );
      const response = await reconcileMutation({
        campaignId: campaignIdFromMutation(request),
        outbox,
        source,
        request,
      });
      const after = await syncCounts(outbox);
      const ok = response.state === "acknowledged";
      const payload = {
        ok,
        driver,
        operation: request.operation,
        mutation: compactMutationResult(response),
        pending: after.pending,
        conflicts: after.conflicts,
      };
      if (json) {
        writeJson(process.stdout, payload);
      } else {
        writeHuman(process.stdout, [
          `driver: ${driver}`,
          `operation: ${request.operation}`,
          `pending: ${after.pending}`,
          `conflicts: ${after.conflicts}`,
          `ok: ${ok}`,
        ]);
      }
      return ok ? 0 : 3;
    }

    if (parsed.command === "validate") {
      assertOkResponse(await source.execute({ schemaVersion: 1, operation: "validate", input: {} }), "validate");

      const payload = { ok: true as const, driver, schemaErrors: [] as string[] };
      if (json) {
        writeJson(process.stdout, payload);
      } else {
        writeHuman(process.stdout, [
          `driver: ${driver}`,
          `freshness: ${syncedAt}`,
          `pending: ${counts.pending}`,
          `conflicts: ${counts.conflicts}`,
          ...(localCoordinationLine(driver) ? [localCoordinationLine(driver)!] : []),
          "ok",
        ]);
      }
      return 0;
    }

    if (parsed.command === "list") {
      const response = assertOkResponse(await source.execute({
        schemaVersion: 1,
        operation: "list",
        input: parsed.status ? { status: parsed.status } : {},
      }), "list");
      const tasks = (response.data as { tasks: Record<string, unknown>[] }).tasks.map((task) => withSource(driver, task));

      const payload = { ok: true as const, driver, freshness: syncedAt, pending: counts.pending, conflicts: counts.conflicts, tasks };
      if (json) {
        writeJson(process.stdout, payload);
      } else {
        writeHuman(process.stdout, [
          `driver: ${driver}`,
          `freshness: ${syncedAt}`,
          `pending: ${counts.pending}`,
          `conflicts: ${counts.conflicts}`,
          ...(localCoordinationLine(driver) ? [localCoordinationLine(driver)!] : []),
          ...tasks.map((task) => `${task.id}\t${task.status}\t${task.title}`),
        ]);
      }
      return 0;
    }

    if (parsed.command === "show") {
      const response = assertOkResponse(await source.execute({
        schemaVersion: 1,
        operation: "show",
        taskId: parsed.taskId!,
        input: {},
      }), "show");

      const task = response.data as Record<string, unknown>;
      const payload = {
        ok: true as const,
        driver,
        freshness: syncedAt,
        pending: counts.pending,
        conflicts: counts.conflicts,
        task,
      };
      if (json) {
        writeJson(process.stdout, payload);
      } else {
        writeHuman(process.stdout, [
          `driver: ${driver}`,
          `freshness: ${syncedAt}`,
          `pending: ${counts.pending}`,
          `conflicts: ${counts.conflicts}`,
          ...(localCoordinationLine(driver) ? [localCoordinationLine(driver)!] : []),
          `${task.id}\t${task.status}\t${task.title}`,
        ]);
      }
      return 0;
    }

    await reconcileAll(outbox, source);
    const after = await syncCounts(outbox);
    const payload = {
      ok: true as const,
      driver,
      freshness: syncedAt,
      pending: after.pending,
      conflicts: after.conflicts,
      resolved: counts.pending - after.pending,
    };
    if (json) {
      writeJson(process.stdout, payload);
    } else {
      writeHuman(process.stdout, [
        `driver: ${driver}`,
        `freshness: ${syncedAt}`,
        `pending: ${after.pending}`,
        `conflicts: ${after.conflicts}`,
        ...(localCoordinationLine(driver) ? [localCoordinationLine(driver)!] : []),
        `resolved: ${counts.pending - after.pending}`,
      ]);
    }
    return 0;
  } catch (error) {
    if (error instanceof CliParseError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }

    const exitCode = exitCodeForError(error);
    process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
    return exitCode;
  } finally {
    await disposeTaskSource(source);
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
    process.exitCode = 1;
  });
