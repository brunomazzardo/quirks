#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkspace } from "../ui/open-workspace.js";
import { CampaignCliParseError, parseCampaignArgs } from "./campaign-args.js";
import { runCampaignCommand } from "./campaign-commands.js";
import { CliParseError } from "./args.js";
import { domainErrorCode, exitCodeForError, writeHuman, writeJson } from "./output.js";

export { CliParseError, CampaignCliParseError, parseCampaignArgs };

export type ParsedUiOpenArgs = {
  campaignId?: string;
  json: boolean;
  stay: boolean;
};

export function parseUiOpenArgs(argv: readonly string[]): ParsedUiOpenArgs {
  if (argv.length === 0 || argv[0] !== "open") {
    throw new CliParseError("ui open requires the open subcommand");
  }

  let campaignId: string | undefined;
  let json = false;
  let stay = false;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      if (json) throw new CliParseError("Duplicate flag --json");
      json = true;
      continue;
    }
    if (token === "--stay") {
      if (stay) throw new CliParseError("Duplicate flag --stay");
      stay = true;
      continue;
    }
    if (token === "--campaign") {
      if (campaignId !== undefined) throw new CliParseError("Duplicate flag --campaign");
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliParseError("Missing value for --campaign");
      }
      campaignId = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) throw new CliParseError(`Unknown option ${token}`);
    throw new CliParseError(`Unexpected argument ${token}`);
  }

  return { ...(campaignId !== undefined ? { campaignId } : {}), json, stay };
}

export function publicOpenPayload(result: Awaited<ReturnType<typeof openWorkspace>>) {
  return {
    ok: result.ok,
    authority: result.authority,
    repositoryId: result.repositoryId,
    ...(result.campaignId !== undefined ? { campaignId: result.campaignId } : {}),
    readOnly: result.readOnly,
    viewerIdleExpiresAt: result.viewerIdleExpiresAt,
    viewerAbsoluteExpiresAt: result.viewerAbsoluteExpiresAt,
    ...(result.approvalExpiresAt ? { approvalExpiresAt: result.approvalExpiresAt } : {}),
  };
}

async function runUiOpen(parsed: ParsedUiOpenArgs): Promise<number> {
  const result = await openWorkspace({
    ...(parsed.campaignId !== undefined ? { campaignId: parsed.campaignId } : {}),
    ports: "production",
    deps: {
      json: parsed.json,
      isTty: process.stdout.isTTY,
    },
  });

  if (parsed.json) {
    writeJson(process.stdout, publicOpenPayload(result));
  } else {
    const payload = publicOpenPayload(result);
    writeHuman(process.stdout, [
      `authority: ${payload.authority}`,
      `repositoryId: ${payload.repositoryId}`,
      ...(payload.campaignId !== undefined ? [`campaignId: ${payload.campaignId}`] : []),
      ...(payload.readOnly ? ["readOnly: true"] : []),
      `viewerIdleExpiresAt: ${payload.viewerIdleExpiresAt}`,
      `viewerAbsoluteExpiresAt: ${payload.viewerAbsoluteExpiresAt}`,
      ...(payload.approvalExpiresAt ? [`approvalExpiresAt: ${payload.approvalExpiresAt}`] : []),
      ...(result.requiresInteractiveRerun
        ? ["Rerun in an interactive terminal to open the local workspace in a browser."]
        : []),
    ]);
  }

  // --stay keeps the workspace serving until SIGINT/SIGTERM regardless of
  // TTY or --json, so scripted callers can hold it open after reading the
  // payload. Without it, the interactive TTY wait is preserved unchanged.
  if (parsed.stay || (!parsed.json && process.stdout.isTTY)) {
    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    if (parsed.stay) await result.close?.();
  }
  return 0;
}

function localCoordinationHumanLines(): string[] {
  return ["Local coordination only", "No shared lease"];
}

async function runCampaignCli(parsed: Exclude<ReturnType<typeof parseCampaignArgs>, { command: "ui" }>): Promise<number> {
  const result = await runCampaignCommand(parsed);
  if (parsed.json) {
    writeJson(process.stdout, result);
  } else {
    const lines = [...localCoordinationHumanLines()];
    if (typeof result === "object" && result !== null && "campaignId" in result) {
      lines.push(`campaignId: ${String((result as { campaignId: string }).campaignId)}`);
    }
    if (typeof result === "object" && result !== null && "ok" in result) {
      lines.push(`ok: ${String((result as { ok: boolean }).ok)}`);
    }
    writeHuman(process.stdout, lines);
  }
  return 0;
}

async function run(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write("Usage: quirks-campaign <command> [options]\n");
    return 2;
  }

  let parsed: ReturnType<typeof parseCampaignArgs>;
  try {
    parsed = parseCampaignArgs(argv);
  } catch (error) {
    if (error instanceof CampaignCliParseError || error instanceof CliParseError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (parsed.command === "ui") {
    let uiParsed: ParsedUiOpenArgs;
    try {
      uiParsed = parseUiOpenArgs(parsed.uiArgv);
    } catch (error) {
      if (error instanceof CliParseError) {
        process.stderr.write(`${error.message}\n`);
        return 2;
      }
      throw error;
    }
    try {
      return await runUiOpen(uiParsed);
    } catch (error) {
      if (uiParsed.json) {
        writeJson(process.stdout, {
          ok: false,
          error: domainErrorCode(error),
          message: error instanceof Error ? error.message : "Unexpected failure",
        });
      } else {
        process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
      }
      return exitCodeForError(error);
    }
  }

  try {
    return await runCampaignCli(parsed);
  } catch (error) {
    if (parsed.json) {
      writeJson(process.stdout, {
        ok: false,
        error: domainErrorCode(error),
        message: error instanceof Error ? error.message : "Unexpected failure",
        localCoordinationOnly: true,
      });
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
    }
    return exitCodeForError(error);
  }
}

/**
 * CLI entry point. Runs the campaign CLI and records the exit code. Exported
 * so thin launcher scripts (for example `scripts/quirks-campaign`) can invoke
 * the CLI explicitly instead of relying on the argv[1] entry guard below,
 * which is false when argv[1] is the launcher rather than this module.
 */
export function runQuirksCampaignCli(): Promise<void> {
  return run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
      process.exitCode = 1;
    });
}

/**
 * True when argv[1] denotes this module as the process entry point. Compares
 * real paths so npm-style bin symlinks to this module still count as direct
 * invocation (Node resolves the main module through symlinks, so a lexical
 * compare alone is false there — a silent no-op, the worst failure mode).
 * Falls back to the lexical compare when realpath fails. Exported for tests.
 */
export function isCliEntryInvocation(moduleUrl: string, argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  const modulePath = path.resolve(fileURLToPath(moduleUrl));
  const argvPath = path.resolve(argv1);
  if (modulePath === argvPath) return true;
  try {
    return realpathSync(modulePath) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

if (isCliEntryInvocation(import.meta.url, process.argv[1])) {
  void runQuirksCampaignCli();
}
