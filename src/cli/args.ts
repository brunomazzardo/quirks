import { assertRepositoryRelativePath } from "../core/repository-path.js";

export type MutationCommand =
  | "propose"
  | "claim"
  | "submit-review"
  | "attach-provenance"
  | "complete"
  | "block"
  | "release";

export type Command = "validate" | "list" | "show" | "sync" | MutationCommand;

export class CliParseError extends Error {
  override readonly name = "CliParseError";
}

export interface ParsedArgs {
  command: Command;
  configPath?: string;
  status?: string;
  taskId?: string;
  requestFile?: string;
  json: boolean;
}

const COMMANDS = new Set<Command>([
  "validate",
  "list",
  "show",
  "sync",
  "propose",
  "claim",
  "submit-review",
  "attach-provenance",
  "complete",
  "block",
  "release",
]);

const MUTATION_COMMANDS = new Set<MutationCommand>([
  "propose",
  "claim",
  "submit-review",
  "attach-provenance",
  "complete",
  "block",
  "release",
]);

export function isMutationCommand(command: Command): command is MutationCommand {
  return MUTATION_COMMANDS.has(command as MutationCommand);
}

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliParseError(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    throw new CliParseError("Missing command");
  }

  const command = argv[0];
  if (!COMMANDS.has(command as Command)) {
    throw new CliParseError(`Unknown command ${command}`);
  }

  let configPath: string | undefined;
  let status: string | undefined;
  let taskId: string | undefined;
  let requestFile: string | undefined;
  let json = false;
  const positionals: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      if (json) throw new CliParseError("Duplicate flag --json");
      json = true;
      continue;
    }
    if (token === "--config") {
      if (configPath !== undefined) throw new CliParseError("Duplicate flag --config");
      configPath = takeValue(argv, index, "--config");
      index += 1;
      continue;
    }
    if (token === "--status") {
      if (status !== undefined) throw new CliParseError("Duplicate flag --status");
      status = takeValue(argv, index, "--status");
      index += 1;
      continue;
    }
    if (token === "--request-file") {
      if (requestFile !== undefined) throw new CliParseError("Duplicate flag --request-file");
      try {
        requestFile = assertRepositoryRelativePath(takeValue(argv, index, "--request-file"));
      } catch {
        throw new CliParseError("request file must be repository-relative");
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new CliParseError(`Unknown option ${token}`);
    }
    if (token.startsWith("-")) {
      throw new CliParseError(`Unknown option ${token}`);
    }
    positionals.push(token);
  }

  if (status !== undefined && command !== "list") {
    throw new CliParseError("--status is only valid for list");
  }

  if (requestFile !== undefined && !MUTATION_COMMANDS.has(command as MutationCommand)) {
    throw new CliParseError("--request-file is only valid for mutation commands");
  }

  if (MUTATION_COMMANDS.has(command as MutationCommand) && requestFile === undefined) {
    throw new CliParseError(`${command} requires --request-file`);
  }

  if (command === "show") {
    if (positionals.length !== 1) {
      throw new CliParseError("show requires exactly one task id");
    }
    taskId = positionals[0];
  } else if (positionals.length > 0) {
    throw new CliParseError("Unexpected positional arguments");
  }

  return {
    command: command as Command,
    ...(configPath ? { configPath } : {}),
    ...(status ? { status } : {}),
    ...(taskId ? { taskId } : {}),
    ...(requestFile ? { requestFile } : {}),
    json,
  };
}
