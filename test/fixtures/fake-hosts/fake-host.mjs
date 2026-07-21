import { setTimeout as delay } from "node:timers/promises";

function parseArgs(argv) {
  let mode = "foreground-complete";
  let campaignId = "cmp-test";
  let scope;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode" && argv[index + 1]) {
      mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--campaign" && argv[index + 1]) {
      campaignId = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--scope" && argv[index + 1]) {
      scope = argv[index + 1];
      index += 1;
    }
  }

  return { mode, campaignId, scope };
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  const { mode, campaignId, scope } = parseArgs(process.argv);

  switch (mode) {
    case "foreground-complete":
      emit({ type: "host.started", campaignId, durable: true });
      emit({ type: "host.completed", campaignId, ok: true });
      return;
    case "conversation-loss":
      emit({ type: "host.started", campaignId, durable: true });
      await delay(50);
      emit({ type: "host.lost", campaignId, reason: "conversation_lost" });
      return;
    case "attach":
      emit({ type: "host.attached", campaignId, ok: true });
      emit({ type: "host.status", campaignId, running: true });
      return;
    case "cancel":
      emit({ type: "host.cancelled", campaignId, scope: scope ?? "campaign", ok: true });
      return;
    case "orphan":
      emit({ type: "host.started", campaignId, durable: true });
      hangForever();
      return;
    default:
      process.stderr.write(`unknown mode: ${mode}\n`);
      process.exit(2);
  }
}

function hangForever() {
  setInterval(() => {}, 60_000);
}

await main();
