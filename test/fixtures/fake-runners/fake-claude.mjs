import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  let mode = "success";
  let sessionId = "11111111-1111-4111-8111-111111111111";

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode" && argv[index + 1]) {
      mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--session-id" && argv[index + 1]) {
      sessionId = argv[index + 1];
      index += 1;
    }
  }

  return { mode, sessionId };
}

function emitInit(sessionId) {
  process.stdout.write(`${JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
  })}\n`);
}

function emitSuccessResult(sessionId, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    result: "Done.",
    ...extra,
  })}\n`);
}

async function writeArtifact(outDir) {
  if (!outDir) return;
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "result.json"), '{"status":"ok"}\n', "utf8");
}

async function main() {
  const { mode, sessionId } = parseArgs(process.argv);
  const outDir = process.env.QUIRKS_FAKE_RUNNER_OUTDIR;

  switch (mode) {
    case "success":
      emitInit(sessionId);
      await writeArtifact(outDir);
      emitSuccessResult(sessionId);
      return;
    case "exit-zero-denied":
      await writeArtifact(outDir);
      emitSuccessResult(sessionId, {
        permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_1", tool_input: {} }],
      });
      return;
    case "timeout":
      setInterval(() => {}, 60_000);
      return;
    case "malformed":
      await writeArtifact(outDir);
      process.stdout.write("All done. Task complete.\n");
      return;
    case "usage-limit":
      process.stdout.write(`${JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { requests_remaining: 0, tokens_remaining: 100 },
      })}\n`);
      return;
    default:
      process.stderr.write(`unknown mode: ${mode}\n`);
      process.exit(2);
  }
}

await main();
