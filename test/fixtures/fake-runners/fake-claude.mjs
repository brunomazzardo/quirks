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

// A fake claude CLI. It writes no result envelope, because no production code
// reads one: since QK-RUN-009 the CLI is left to speak naturally and a managing
// agent derives the structured result. What this fake owes the launcher is the
// real stream-json event shape, its exit code, and prose that means something.

function emitInit(sessionId) {
  process.stdout.write(`${JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
  })}\n`);
}

function emitAssistantText(sessionId, text) {
  process.stdout.write(`${JSON.stringify({
    type: "assistant",
    session_id: sessionId,
    message: { role: "assistant", content: [{ type: "text", text }] },
  })}\n`);
}

function emitSuccessResult(sessionId, result = "Done: the work is complete and committed. Accept as it stands.", extra = {}) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    result,
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
      emitSuccessResult(sessionId);
      return;
    case "success-no-disk":
      emitInit(sessionId);
      emitSuccessResult(sessionId);
      return;
    case "review-revise":
      emitInit(sessionId);
      emitAssistantText(sessionId, FAKE_REVIEW_REVISE_PROSE);
      emitSuccessResult(sessionId, FAKE_REVIEW_REVISE_PROSE);
      return;
    case "review-accept":
      emitInit(sessionId);
      emitAssistantText(sessionId, FAKE_REVIEW_ACCEPT_PROSE);
      emitSuccessResult(sessionId, FAKE_REVIEW_ACCEPT_PROSE);
      return;
    case "review-silent":
      // Ran, said nothing about accepting or revising. The interpretation must
      // come back indeterminate rather than reading calm as approval.
      emitInit(sessionId);
      emitSuccessResult(sessionId, "I read the file. It defines one function.");
      return;
    case "permission-exit-zero":
    case "exit-zero-denied":
      await writeArtifact(outDir);
      emitSuccessResult(sessionId, "Blocked by permissions.", {
        permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_1", tool_input: {} }],
      });
      return;
    case "partial":
      emitInit(sessionId);
      await writePartialArtifact(outDir);
      emitErrorResult(sessionId, { result: "honest_partial" });
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
      emitSuccessResult(sessionId, "All tests passed.");
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
