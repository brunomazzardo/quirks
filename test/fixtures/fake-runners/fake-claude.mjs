import {
  commitWork,
  briefPathFromArgv,
  declaredEnvelopePath,
  hangForever,
  oversizedPayload,
  parseRunnerArgs,
  wedgeAfterWork,
  writeArtifact,
  writeDeclaredEnvelope,
  writePartialArtifact,
} from "./shared-modes.mjs";

// The claude CLI has no --output-schema/-o equivalent, so a claude job learns
// its envelope path from the brief exactly as a cursor job does. Deriving it
// any other way would let this fake pass while the real runner writes nothing,
// which is how the missing claude result contract went unnoticed (QK-RUN-007).
async function writeEnvelope(sessionId, envelope = {}) {
  const envelopePath = await declaredEnvelopePath(briefPathFromArgv(process.argv));
  return writeDeclaredEnvelope(envelopePath, { sessionHandle: sessionId, ...envelope });
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

function emitErrorResult(sessionId, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "error",
    session_id: sessionId,
    is_error: true,
    result: "Runner failed.",
    ...extra,
  })}\n`);
}

async function main() {
  const { mode, sessionId } = parseRunnerArgs(process.argv);
  const outDir = process.env.QUIRKS_FAKE_RUNNER_OUTDIR;

  switch (mode) {
    case "success":
      await commitWork(process.argv);
      emitInit(sessionId);
      await writeArtifact(outDir);
      await writeEnvelope(sessionId);
      emitSuccessResult(sessionId);
      return;
    case "success-no-disk":
      emitInit(sessionId);
      emitSuccessResult(sessionId);
      return;
    case "permission-exit-zero":
    case "exit-zero-denied":
      await writeArtifact(outDir);
      await writeEnvelope(sessionId);
      emitSuccessResult(sessionId, {
        permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_1", tool_input: {} }],
      });
      return;
    case "partial":
      emitInit(sessionId);
      await writePartialArtifact(outDir);
      await writeEnvelope(sessionId, { status: "failure", failure: "honest_partial" });
      emitErrorResult(sessionId, { result: "honest_partial" });
      return;
    case "malformed":
      await writeArtifact(outDir);
      await writeEnvelope(sessionId);
      process.stdout.write("All done. Task complete.\n");
      return;
    case "oversized":
      process.stdout.write(oversizedPayload());
      return;
    case "transient":
      emitInit(sessionId);
      emitErrorResult(sessionId, { result: "transient_runner" });
      process.exitCode = 1;
      return;
    case "usage-limit":
      process.stdout.write(`${JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { requests_remaining: 0, tokens_remaining: 100 },
      })}\n`);
      return;
    case "silence":
    case "timeout":
      hangForever();
      return;
    case "wedge-after-work":
      emitInit(sessionId);
      await wedgeAfterWork(outDir, () => emitSuccessResult(sessionId));
      return;
    case "non-resumable":
      emitInit(sessionId);
      emitErrorResult(sessionId, { result: "non-resumable", session_id: "invalid-resume-handle" });
      return;
    case "fabricated-tests":
      emitInit(sessionId);
      emitSuccessResult(sessionId, { result: "All tests passed." });
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
