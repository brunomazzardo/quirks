import { QuirksError } from "../core/errors.js";
import type { ProjectContext } from "../project/types.js";
import type { CredentialResolver } from "./credentials.js";
import type { TaskSource } from "./task-source.js";

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
    throw new QuirksError("UNSUPPORTED_VERSION", "JSON task source driver is not yet implemented");
  }

  throw new QuirksError("UNSUPPORTED_VERSION", "External task source driver is not yet implemented");
}
