import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  hangForever,
  oversizedPayload,
  parseRunnerArgs,
  wedgeAfterWork,
  writeArtifact,
  writePartialArtifact,
} from "./shared-modes.mjs";

// cursor-agent has no flag that accepts a prompt file: the brief arrives inside
// the trailing positional instruction built by `cursorPromptText`. Parsing it
// the way a real cursor job would keeps this fake honest about the boundary.
function briefPathOf(argv) {
  for (const entry of argv) {
    const match = entry.match(/^Read the brief at (.+?), complete it,/);
    if (match) return match[1];
  }
  return undefined;
}

// A compliant cursor job reads its brief and follows the runner result
// contract: cursor has no --output-schema/-o equivalent, so the declared
// envelope path exists only as brief text.
async function declaredEnvelopePath(argv) {
  const briefPath = briefPathOf(argv);
  if (!briefPath) return undefined;
  try {
    const brief = await readFile(briefPath, "utf8");
    const match = brief.match(/write your result envelope JSON to exactly this path: (.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

async function writeEnvelope(argv, sessionId, envelope = {}) {
  const envelopePath = await declaredEnvelopePath(argv);
  if (!envelopePath) return;
  await mkdir(path.dirname(envelopePath), { recursive: true });
  const payload = {
    status: "success",
    sessionHandle: sessionId,
    artifactPaths: [envelopePath],
    failure: null,
    ...envelope,
  };
  await writeFile(envelopePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function emitInit(sessionId) {
  process.stdout.write(`${JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    threadId: sessionId,
  })}\n`);
}

function emitResult(sessionId, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    threadId: sessionId,
    is_error: false,
    ...extra,
  })}\n`);
}

function emitErrorResult(sessionId, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "error",
    session_id: sessionId,
    threadId: sessionId,
    is_error: true,
    error: message,
    ...extra,
  })}\n`);
}

async function main() {
  const { mode, sessionId } = parseRunnerArgs(process.argv);
  const outDir = process.env.QUIRKS_FAKE_RUNNER_OUTDIR;

  switch (mode) {
    case "success":
      emitInit(sessionId);
      await writeArtifact(outDir);
      await writeEnvelope(process.argv, sessionId);
      emitResult(sessionId);
      return;
    case "success-no-disk":
      emitInit(sessionId);
      await writeEnvelope(process.argv, sessionId, { artifactPaths: [] });
      emitResult(sessionId);
      return;
    case "permission-exit-zero":
    case "exit-zero-denied":
      emitInit(sessionId);
      emitErrorResult(sessionId, "permission denied by host", { message: "permission denied" });
      return;
    case "partial":
      emitInit(sessionId);
      await writePartialArtifact(outDir);
      await writeEnvelope(process.argv, sessionId, { status: "failure", failure: "honest_partial" });
      emitErrorResult(sessionId, "honest_partial");
      return;
    case "malformed":
      await writeArtifact(outDir);
      process.stdout.write("All done. Task complete.\n");
      return;
    case "oversized":
      process.stdout.write(oversizedPayload());
      return;
    case "transient":
      emitInit(sessionId);
      emitErrorResult(sessionId, "transient_runner");
      process.exitCode = 1;
      return;
    case "usage-limit":
      emitInit(sessionId);
      emitErrorResult(sessionId, "usage limit reached", { message: "rate limit exceeded" });
      return;
    case "silence":
    case "timeout":
      hangForever();
      return;
    case "wedge-after-work":
      emitInit(sessionId);
      await wedgeAfterWork(outDir, () => emitResult(sessionId));
      return;
    case "non-resumable":
      emitInit(sessionId);
      emitErrorResult(sessionId, "non-resumable", { threadId: "invalid-resume-handle" });
      return;
    case "fabricated-tests":
      emitInit(sessionId);
      emitResult(sessionId, { message: "tests passed" });
      return;
    case "cancel":
      process.exitCode = 130;
      return;
    case "orphan":
      hangForever();
      return;
    default:
      process.stderr.write(`unknown mode: ${mode}\n`);
      process.exit(2);
  }
}

await main();
