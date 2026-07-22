import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRunnerArgs } from "./shared-modes.mjs";

function parseWorkspace(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-C" && argv[index + 1]) return argv[index + 1];
  }
  return process.cwd();
}

async function writeCodexResult(resultPath, payload) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function main() {
  const { sessionId, resultPath } = parseRunnerArgs(process.argv);
  const workspace = parseWorkspace(process.argv);
  const reviewRelative = process.env.QUIRKS_BOUNDED_REVIEW_PATH ?? ".quirks/reviews/review.md";
  const reviewPath = path.join(workspace, reviewRelative);
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, "# Bounded review\n\nApproved.\n", "utf8");
  if (!resultPath) {
    process.stderr.write("missing -o result path\n");
    process.exit(2);
  }
  await writeCodexResult(resultPath, {
    status: "success",
    sessionHandle: sessionId,
    artifactPaths: [reviewPath],
  });
}

await main();
