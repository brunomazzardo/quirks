import { sha256 } from "../../core/hash.js";
import { validateSchema } from "../../schema/validate.js";

export type NativeTask = Record<string, unknown> & {
  id: string;
  status: string;
};

export function nativeTaskRevision(task: NativeTask): string {
  return sha256(task);
}

export function normalizeNativeTask(task: NativeTask): {
  schemaVersion: 1;
  nativeRevision: string;
  id: string;
  [key: string]: unknown;
} {
  const normalized = {
    schemaVersion: 1 as const,
    ...task,
    source: { driver: "json", nativeId: task.id, webUrl: null },
    nativeRevision: nativeTaskRevision(task),
  };
  return validateSchema("normalized-task-v1", normalized) as {
    schemaVersion: 1;
    nativeRevision: string;
    id: string;
    [key: string]: unknown;
  };
}

export function listSummary(task: NativeTask) {
  return {
    id: task.id,
    title: task.title as string,
    status: task.status,
    nativeRevision: nativeTaskRevision(task),
  };
}
