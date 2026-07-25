import {
  commitWork,
  FAKE_REVIEW_ACCEPT_PROSE,
  FAKE_REVIEW_REVISE_PROSE,
  hangForever,
  oversizedPayload,
  parseRunnerArgs,
  wedgeAfterWork,
  writeArtifact,
  writePartialArtifact,
} from "./shared-modes.mjs";

// A fake cursor-agent. Cursor's `--output-format json` emits a single JSON
// document at the end rather than a JSONL stream — measured against the real
// binary on 2026-07-25, where a full review arrived as one 994-byte object with
// the whole review in `result`. It writes no envelope: cursor never had an
// --output-schema equivalent, and production no longer asks for one.

function emitResult(sessionId, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: sessionId,
    threadId: sessionId,
    duration_ms: 12,
    result: "Done: the work is complete and committed. Accept as it stands.",
    ...extra,
  })}\n`);
}

function emitErrorResult(sessionId, message, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    session_id: sessionId,
    threadId: sessionId,
    error: message,
    ...extra,
  })}\n`);
}

async function main() {
  const { mode, sessionId } = parseRunnerArgs(process.argv);
  const outDir = process.env.QUIRKS_FAKE_RUNNER_OUTDIR;

  switch (mode) {
    case "success":
      await commitWork(process.argv);
      await writeArtifact(outDir);
      emitResult(sessionId);
      return;
    case "success-no-disk":
      emitResult(sessionId, { result: "Done. I changed no files." });
      return;
    case "review-revise":
      emitResult(sessionId, { result: FAKE_REVIEW_REVISE_PROSE });
      return;
    case "review-accept":
      emitResult(sessionId, { result: FAKE_REVIEW_ACCEPT_PROSE });
      return;
    case "review-silent":
      emitResult(sessionId, { result: "I read the file. It defines one function." });
      return;
    case "permission-exit-zero":
    case "exit-zero-denied":
      emitErrorResult(sessionId, "permission denied by host", { message: "permission denied" });
      return;
    case "partial":
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
      emitErrorResult(sessionId, "transient_runner");
      process.exitCode = 1;
      return;
    case "usage-limit":
      emitErrorResult(sessionId, "usage limit reached", { message: "rate limit exceeded" });
      return;
    case "silence":
    case "timeout":
      hangForever();
      return;
    case "wedge-after-work":
      await wedgeAfterWork(outDir, () => emitResult(sessionId));
      return;
    case "non-resumable":
      emitErrorResult(sessionId, "non-resumable", { threadId: "invalid-resume-handle" });
      return;
    case "fabricated-tests":
      emitResult(sessionId, { result: "All tests passed." });
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
