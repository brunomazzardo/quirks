export type Command = "validate" | "list" | "show" | "sync";

export class CliParseError extends Error {
  override readonly name = "CliParseError";
}

export interface ParsedArgs {
  command: Command;
  configPath?: string;
  status?: string;
  taskId?: string;
  json: boolean;
}

const COMMANDS = new Set<Command>(["validate", "list", "show", "sync"]);

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
    json,
  };
}
