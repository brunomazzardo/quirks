import { QuirksError } from "../core/errors.js";
import type { ProjectContext } from "../project/types.js";
import type { CredentialResolver } from "./credentials.js";
import {
  DEFAULT_ADAPTER_TIMEOUT_MS,
  ExternalTaskSource,
} from "./external/external-task-source.js";
import { JsonTaskSource } from "./json/json-task-source.js";
import { MAX_PROTOCOL_BYTES, type TaskSource } from "./task-source.js";

export interface CreateTaskSourceOptions {
  credentialResolver?: CredentialResolver;
}

export async function createTaskSource(
  context: ProjectContext,
  options: CreateTaskSourceOptions = {},
): Promise<TaskSource> {
  const { taskSource } = context.config;
  const driver = taskSource.driver as string;

  if (driver !== "json" && driver !== "external") {
    throw new QuirksError("UNSUPPORTED_VERSION", `Unsupported task source driver ${JSON.stringify(driver)}`);
  }

  if (taskSource.driver === "external" && taskSource.credentialAlias && !options.credentialResolver) {
    throw new QuirksError(
      "SOURCE_UNAVAILABLE",
      "External task source requires an injected credential resolver",
    );
  }

  if (taskSource.driver === "json") {
    return JsonTaskSource.open(context.root);
  }

  const credentialVariables =
    taskSource.credentialAlias && options.credentialResolver
      ? await options.credentialResolver.resolve(
          taskSource.credentialAlias,
          taskSource.credentialEnvironmentNames ?? [],
        )
      : {};

  return new ExternalTaskSource({
    command: taskSource.command,
    timeoutMs: DEFAULT_ADAPTER_TIMEOUT_MS,
    maxOutputBytes: MAX_PROTOCOL_BYTES,
    repositoryRoot: context.root,
    credentialVariables,
  });
}
