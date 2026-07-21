import path from "node:path";
import {
  hangForever,
  oversizedPayload,
  parseRunnerArgs,
  wedgeAfterWork,
  writeArtifact,
  writePartialArtifact,
} from "./shared-modes.mjs";

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
  const artifacts = outDir ? [path.join(outDir, "result.json")] : [];

  switch (mode) {
    case "success":
      emitInit(sessionId);
      await writeArtifact(outDir);
      emitResult(sessionId);
      return;
    case "success-no-disk":
      emitInit(sessionId);
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
