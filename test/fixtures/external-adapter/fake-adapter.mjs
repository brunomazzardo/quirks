import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_PROTOCOL_BYTES = 1_048_576;
const SUPPORTED_OPERATIONS = [
  "capabilities",
  "validate",
  "list",
  "show",
  "claim",
  "submit-review",
  "attach-provenance",
  "complete",
  "block",
  "release",
  "propose",
  "verify",
];

function statePath() {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  return path.join(home, "adapter-state.json");
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath(), "utf8"));
  } catch {
    const task = {
      id: "QK-1",
      title: "Contract task",
      kind: "implementation",
      priority: "P1",
      status: "ready",
      dependsOn: [],
      workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
      execution: {
        effort: "standard",
        risk: [],
        capabilities: ["repository-write"],
        parallelismKeys: [],
        humanGates: [],
        completionBoundary: "accepted-commit",
      },
      sourceRefs: [],
      deliverables: [],
      acceptanceCriteria: ["Contract passes"],
      verification: ["pnpm test"],
      provenance: { schemaVersion: 1, iterations: [] },
      coordination: null,
      statusDetail: null,
    };
    return { tasks: { "QK-1": task }, idempotency: {} };
  }
}

async function saveState(state) {
  await writeFile(statePath(), JSON.stringify(state), "utf8");
}

function taskRevision(task) {
  return `sha256:${sha256(task)}`;
}

function normalizedTask(task) {
  return {
    schemaVersion: 1,
    ...task,
    source: { driver: "external-fixture", nativeId: task.id, webUrl: null },
    nativeRevision: taskRevision(task),
  };
}

function listSummary(task) {
  return { id: task.id, title: task.title, status: task.status, nativeRevision: taskRevision(task) };
}

function failure(operation, code, message, retryable = false) {
  return { schemaVersion: 1, operation, ok: false, error: { code, message, retryable } };
}

function capabilities() {
  return {
    schemaVersion: 1,
    protocol: "task-source-v1",
    driver: "external-fixture",
    concurrencyStrength: "local-only",
    provenanceWriteMode: "structured",
    commentWriteMode: "none",
    idempotencyLookup: "key",
    operations: SUPPORTED_OPERATIONS,
    authorityClasses: ["repository"],
    completionBoundaries: ["accepted-commit"],
    maxRequestBytes: MAX_PROTOCOL_BYTES,
    maxResponseBytes: MAX_PROTOCOL_BYTES,
  };
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mutationRequestHash(request) {
  return sha256({
    operation: request.operation,
    taskId: request.taskId,
    expectedNativeRevision: request.expectedNativeRevision,
    idempotencyKey: request.idempotencyKey,
    input: request.input,
  });
}

async function applyMutation(state, request, mutate, guard) {
  const requestHash = mutationRequestHash(request);
  const cached = state.idempotency[request.idempotencyKey];
  if (cached) {
    if (cached.requestHash !== requestHash) {
      return failure(request.operation, "SOURCE_CONFLICT", "Idempotency key reused with different request");
    }
    return cached.response;
  }

  const task = state.tasks[request.taskId];
  if (!task) return failure(request.operation, "NOT_FOUND", `Unknown task ${request.taskId}`);
  if (taskRevision(task) !== request.expectedNativeRevision) {
    return failure(request.operation, "STALE_REVISION", "Task revision is stale");
  }

  const guardFailure = guard?.(task);
  if (guardFailure) return guardFailure;

  mutate(task);
  const data = normalizedTask(task);
  const response = {
    schemaVersion: 1,
    operation: request.operation,
    ok: true,
    nativeRevision: data.nativeRevision,
    data,
  };
  state.idempotency[request.idempotencyKey] = { requestHash, response };
  await saveState(state);
  return response;
}

async function dispatch(request) {
  const state = await loadState();
  switch (request.operation) {
    case "capabilities":
      return { schemaVersion: 1, operation: "capabilities", ok: true, data: capabilities() };
    case "validate":
      return { schemaVersion: 1, operation: "validate", ok: true, data: { valid: true } };
    case "list": {
      const tasks = Object.values(state.tasks)
        .filter((task) => !request.input?.status || task.status === request.input.status)
        .map(listSummary);
      return { schemaVersion: 1, operation: "list", ok: true, data: { tasks } };
    }
    case "show": {
      const task = state.tasks[request.taskId];
      if (!task) return failure("show", "NOT_FOUND", `Unknown task ${request.taskId}`);
      const data = normalizedTask(task);
      return { schemaVersion: 1, operation: "show", ok: true, nativeRevision: data.nativeRevision, data };
    }
    case "verify":
      return { schemaVersion: 1, operation: "verify", ok: true, data: { scope: request.input.scope, valid: true } };
    case "claim":
      return applyMutation(
        state,
        request,
        (task) => {
          task.status = "claimed";
          task.coordination = {
            scope: "local-clone",
            campaignId: request.input.campaignId,
            owner: request.input.owner,
            claimedAt: request.input.claimedAt,
          };
        },
        (task) =>
          task.status !== "ready"
            ? failure("claim", "SOURCE_CONFLICT", "Task is not ready to claim")
            : undefined,
      );
    case "release":
      return applyMutation(state, request, (task) => {
        task.status = "ready";
        task.coordination = null;
      });
    case "block":
      return applyMutation(state, request, (task) => {
        task.status = "blocked";
        task.statusDetail = {
          reason: request.input.reason,
          unblockCondition: request.input.unblockCondition,
        };
      });
    case "submit-review":
      return applyMutation(state, request, (task) => {
        task.status = "in_review";
      });
    case "complete":
      return applyMutation(state, request, (task) => {
        task.status = "completed";
        task.coordination = null;
      });
    case "attach-provenance":
    case "propose":
      return applyMutation(state, request, () => undefined);
    default:
      return failure(request.operation, "PROTOCOL_VIOLATION", `Unsupported operation ${request.operation}`);
  }
}

function writeLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  const mode = process.env.QUIRKS_FIXTURE_MODE;
  const input = await new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.trim()));
    process.stdin.on("error", reject);
  });

  if (!input) {
    process.exit(2);
  }

  const request = JSON.parse(input);

  if (mode === "env-probe") {
    writeLine({
      schemaVersion: 1,
      operation: "capabilities",
      ok: true,
      data: {
        ...capabilities(),
        envKeys: Object.keys(process.env).toSorted(),
        home: process.env.HOME ?? process.env.USERPROFILE ?? null,
      },
    });
    return;
  }

  if (mode === "timeout") {
    await new Promise(() => {});
  }

  if (mode === "malformed") {
    process.stdout.write("not-json\n");
    return;
  }

  if (mode === "exit-zero-error") {
    process.exit(3);
  }

  const response = await dispatch(request);

  if (mode === "stale") {
    writeLine({ ...response, operation: "capabilities" });
    return;
  }

  if (mode === "secret") {
    writeLine({
      schemaVersion: 1,
      operation: request.operation,
      ok: true,
      data: { token: "Bearer abc.def.ghi" },
    });
    return;
  }

  if (mode === "oversized") {
    writeLine({
      schemaVersion: 1,
      operation: request.operation,
      ok: true,
      data: { blob: "x".repeat(MAX_PROTOCOL_BYTES + 1) },
    });
    return;
  }

  writeLine(response);

  if (mode === "extra-stdout") {
    process.stdout.write("trailing-garbage\n");
  }
}

main().catch(() => process.exit(1));
