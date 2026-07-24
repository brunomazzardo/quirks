import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  commitWork,
  hangForever,
  oversizedPayload,
  parseRunnerArgs,
  wedgeAfterWork,
  writeArtifact,
  writePartialArtifact,
  verdictForEnvelopePath,
} from "./shared-modes.mjs";

async function writeCodexResult(resultPath, payload) {
  if (!resultPath) {
    process.stderr.write("missing -o result path\n");
    process.exit(2);
  }
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function main() {
  const { mode, sessionId, resultPath } = parseRunnerArgs(process.argv);
  const outDir = process.env.QUIRKS_FAKE_RUNNER_OUTDIR;

  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "codex-argv.json"), `${JSON.stringify(process.argv.slice(2))}\n`, "utf8");
  }

  switch (mode) {
    case "success": {
      await commitWork(process.argv);
      const artifactPath = await writeArtifact(outDir);
      await writeCodexResult(resultPath, {
        status: "success",
        verdict: verdictForEnvelopePath(resultPath),
        sessionHandle: sessionId,
        artifactPaths: artifactPath ? [artifactPath] : [resultPath],
      });
      return;
    }
    case "success-no-disk": {
      await writeCodexResult(resultPath, {
        status: "success",
        verdict: verdictForEnvelopePath(resultPath),
        sessionHandle: sessionId,
        artifactPaths: [],
      });
      return;
    }
    case "permission-exit-zero":
    case "exit-zero-denied": {
      await writeCodexResult(resultPath, {
        status: "permission_denied",
        sessionHandle: sessionId,
        artifactPaths: [],
        failure: "permission denied",
      });
      return;
    }
    case "partial": {
      const artifactPath = await writePartialArtifact(outDir);
      await writeCodexResult(resultPath, {
        status: "failure",
        sessionHandle: sessionId,
        artifactPaths: artifactPath ? [artifactPath] : [],
        failure: "honest_partial",
      });
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
      await writeCodexResult(resultPath, {
        status: "failure",
        sessionHandle: sessionId,
        artifactPaths: [],
        failure: "transient_runner",
      });
      process.exitCode = 1;
      return;
    }
    case "usage-limit": {
      await writeCodexResult(resultPath, {
        status: "usage_limit",
        sessionHandle: sessionId,
        artifactPaths: [],
        failure: "usage limit reached",
      });
      return;
    }
    case "silence":
    case "timeout":
      hangForever();
      return;
    case "wedge-after-work":
      await wedgeAfterWork(outDir, async () => {
        await writeCodexResult(resultPath, {
          status: "success",
          verdict: verdictForEnvelopePath(resultPath),
          sessionHandle: sessionId,
          artifactPaths: outDir ? [path.join(outDir, "result.json")] : [],
        });
      });
      return;
    case "session-mismatch": {
      process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: "jsonl-session-999" })}\n`);
      const artifactPath = await writeArtifact(outDir);
      await writeCodexResult(resultPath, {
        status: "success",
        verdict: verdictForEnvelopePath(resultPath),
        sessionHandle: "envelope-session-000",
        artifactPaths: artifactPath ? [artifactPath] : [resultPath],
      });
      return;
    }
    case "non-resumable": {
      await writeCodexResult(resultPath, {
        status: "failure",
        sessionHandle: "invalid-resume-handle",
        artifactPaths: [],
        failure: "non-resumable",
      });
      return;
    }
    case "fabricated-tests": {
      await writeCodexResult(resultPath, {
        status: "success",
        verdict: verdictForEnvelopePath(resultPath),
        sessionHandle: sessionId,
        artifactPaths: [],
        failure: "fabricated_evidence",
      });
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
