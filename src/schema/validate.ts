import * as validators from "./generated/validators.mjs";
import { QuirksError } from "../core/errors.js";

export type SchemaName =
  | "project-config-v1"
  | "json-task-file-v1"
  | "normalized-task-v1"
  | "task-provenance-v1"
  | "task-source-capabilities-v1"
  | "task-source-request-v1"
  | "task-source-response-v1"
  | "task-sync-intent-v1";

type Validator = ((value: unknown) => boolean) & {
  errors?: readonly { instancePath?: string; message?: string }[] | null;
};

export function validateSchema<T>(name: SchemaName, value: unknown): T {
  const key = name.replaceAll("-", "_") as keyof typeof validators;
  const validate = validators[key] as Validator | undefined;
  if (!validate || !validate(value)) {
    const message = validate?.errors?.map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`).join("; ") ?? `Unknown schema ${name}`;
    throw new QuirksError("SCHEMA_INVALID", message);
  }
  return value as T;
}
