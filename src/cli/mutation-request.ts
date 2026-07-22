import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { QuirksError } from "../core/errors.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import { validateSchema } from "../schema/validate.js";
import type { MutationOperation, MutationRequest, TaskSourceRequest } from "../task-source/types.js";
import { CliParseError } from "./args.js";

export async function readMutationRequest(
  repositoryRoot: string,
  requestPath: string,
  expectedOperation: MutationOperation,
  maxRequestBytes: number,
): Promise<MutationRequest> {
  let relative: string;
  try {
    relative = assertRepositoryRelativePath(requestPath);
  } catch {
    throw new CliParseError("request file must be repository-relative");
  }

  const root = await realpath(repositoryRoot);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new CliParseError("request file must remain inside the repository");
  }

  let resolved: string;
  try {
    resolved = await realpath(absolute);
  } catch {
    throw new QuirksError("SCHEMA_INVALID", `Request file is unavailable: ${relative}`);
  }
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new CliParseError("request file must remain inside the repository");
  }

  const raw = await readFile(resolved, "utf8");
  if (Buffer.byteLength(raw, "utf8") > maxRequestBytes) {
    throw new QuirksError("SCHEMA_INVALID", `Request file exceeds ${maxRequestBytes} bytes`);
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new QuirksError("SCHEMA_INVALID", "Request file is not valid JSON");
  }

  const request = validateSchema<TaskSourceRequest>("task-source-request-v1", value);
  if (!("expectedNativeRevision" in request) || request.operation !== expectedOperation) {
    throw new CliParseError(`request operation must be ${expectedOperation}`);
  }
  return request;
}
