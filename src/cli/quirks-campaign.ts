#!/usr/bin/env node
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
};

export function parseUiOpenArgs(argv: readonly string[]): ParsedUiOpenArgs {
  if (argv.length === 0 || argv[0] !== "open") {
    throw new CliParseError("ui open requires the open subcommand");
  }

  let campaignId: string | undefined;
  let json = false;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      if (json) throw new CliParseError("Duplicate flag --json");
      json = true;
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

  return { ...(campaignId !== undefined ? { campaignId } : {}), json };
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

  if (!parsed.json && process.stdout.isTTY) {
    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
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

const isCliEntry =
  process.argv[1] !== undefined && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isCliEntry) {
  void run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
      process.exitCode = 1;
    });
}
