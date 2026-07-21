#!/usr/bin/env node
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import { createTaskSource } from "../task-source/factory.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { SyncOutbox } from "../sync/outbox.js";
import { reconcilePending } from "../sync/reconciler.js";
import type { TaskSource } from "../task-source/task-source.js";
import type { TaskSourceCapabilities, TaskSourceResponse } from "../task-source/types.js";
import { CliParseError, parseArgs } from "./args.js";
import {
  domainErrorCode,
  exitCodeForError,
  formatFreshness,
  localCoordinationLine,
  writeHuman,
  writeJson,
} from "./output.js";

async function openOutbox(repositoryId: string): Promise<SyncOutbox> {
  const appPaths = resolveAppPaths(repositoryId);
  return SyncOutbox.open(path.join(appPaths.repository, "sync-outbox.jsonl"));
}

async function readCapabilities(source: TaskSource): Promise<TaskSourceCapabilities> {
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  if (!response.ok || response.operation !== "capabilities") {
    throw new Error("Task source capabilities unavailable");
  }
  return response.data as TaskSourceCapabilities;
}

function assertOkResponse<O extends TaskSourceResponse["operation"]>(
  response: TaskSourceResponse,
  operation: O,
): Extract<TaskSourceResponse, { operation: O; ok: true }> {
  if (!response.ok) {
    throw new QuirksError("PROTOCOL_VIOLATION", response.error.message);
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

async function run(): Promise<number> {
  let json = false;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    json = parsed.json;

    const context = await loadProjectContext(process.cwd(), {
      mode: "inspection",
      ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
    });
    const source = await createTaskSource(context);
    const capabilities = await readCapabilities(source);
    const driver = capabilities.driver;
    const outbox = await openOutbox(context.repositoryId);
    const syncedAt = formatFreshness(new Date().toISOString());
    const counts = await syncCounts(outbox);

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
      if (!json) process.stderr.write(`${error.message}\n`);
      return 2;
    }

    const exitCode = exitCodeForError(error);
    if (json) {
      writeJson(process.stdout, {
        ok: false,
        error: domainErrorCode(error),
        message: error instanceof Error ? error.message : "Unexpected failure",
      });
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
    }
    return exitCode;
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
