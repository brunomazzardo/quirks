import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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

// A fake codex CLI emitting the `--json` event stream. It writes no result
// envelope: --output-schema and -o are gone from the production argv, because
// they were measured suppressing codex's reasoning entirely (0 prose messages
// with them, 8 without). A fake that still wrote one would be mimicking a
// contract production no longer has.

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitThread(sessionId) {
  emit({ type: "thread.started", thread_id: sessionId });
  emit({ type: "turn.started" });
}

function emitAgentMessage(text) {
  emit({ type: "item.completed", item: { id: "item_0", type: "agent_message", text } });
}

function emitTurnCompleted() {
  emit({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
}

async function main() {
  const { mode, sessionId } = parseRunnerArgs(process.argv);
  const outDir = process.env.QUIRKS_FAKE_RUNNER_OUTDIR;

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "codex-argv.json"), `${JSON.stringify(process.argv.slice(2))}\n`, "utf8");
  }

  switch (mode) {
    case "success": {
      await commitWork(process.argv);
      await writeArtifact(outDir);
      emitThread(sessionId);
      emitAgentMessage("Done: the change is committed. Accept as it stands.");
      emitTurnCompleted();
      return;
    }
    case "success-no-disk": {
      emitThread(sessionId);
      emitAgentMessage("Done. I changed no files.");
      emitTurnCompleted();
      return;
    }
    case "review-revise": {
      emitThread(sessionId);
      emitAgentMessage(FAKE_REVIEW_REVISE_PROSE);
      emitTurnCompleted();
      return;
    }
    case "review-accept": {
      emitThread(sessionId);
      emitAgentMessage(FAKE_REVIEW_ACCEPT_PROSE);
      emitTurnCompleted();
      return;
    }
    case "review-silent": {
      emitThread(sessionId);
      emitAgentMessage("I read the file. It defines one function.");
      emitTurnCompleted();
      return;
    }
    case "permission-exit-zero":
    case "exit-zero-denied": {
      emitThread(sessionId);
      emit({ type: "error", message: "permission denied by sandbox" });
      emit({ type: "turn.failed", error: { message: "permission denied by sandbox" } });
      return;
    }
    case "partial": {
      await writePartialArtifact(outDir);
      emitThread(sessionId);
      emitAgentMessage("I got part of the way and stopped: honest_partial.");
      emit({ type: "turn.failed", error: { message: "honest_partial" } });
      return;
    }
    case "malformed": {
      await writeArtifact(outDir);
      process.stdout.write("All done. Task complete.\n");
      return;
    }
    case "oversized": {
      process.stdout.write(oversizedPayload());
      return;
    }
    case "transient": {
      emitThread(sessionId);
      emit({ type: "turn.failed", error: { message: "transient_runner" } });
      process.exitCode = 1;
      return;
    }
    case "usage-limit": {
      emitThread(sessionId);
      emit({ type: "error", message: "You've hit your usage limit." });
      emit({ type: "turn.failed", error: { message: "You've hit your usage limit." } });
      return;
    }
    case "silence":
    case "timeout":
      hangForever();
      return;
    case "wedge-after-work":
      emitThread(sessionId);
      await wedgeAfterWork(outDir, () => {
        emitAgentMessage("Done.");
        emitTurnCompleted();
      });
      return;
    case "session-mismatch": {
      emit({ type: "thread.started", thread_id: "jsonl-session-999" });
      await writeArtifact(outDir);
      emitAgentMessage("Done.");
      emitTurnCompleted();
      return;
    }
    case "non-resumable": {
      emit({ type: "thread.started", thread_id: "invalid-resume-handle" });
      emit({ type: "turn.failed", error: { message: "non-resumable" } });
      return;
    }
    case "fabricated-tests": {
      emitThread(sessionId);
      emitAgentMessage("All tests passed.");
      emitTurnCompleted();
      return;
    }
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
