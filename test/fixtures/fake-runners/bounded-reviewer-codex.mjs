import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRunnerArgs } from "./shared-modes.mjs";

// A bounded-campaign reviewer. It writes its review file and says what it
// decided in prose — no result envelope, because nothing reads one since
// QK-RUN-009. Its recommendation has to be in the transcript for the managing
// agent to quote, exactly as a real reviewer's is.

function parseWorkspace(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-C" && argv[index + 1]) return argv[index + 1];
  }
  return process.cwd();
}

const RECOMMENDATIONS = {
  accept: "I reviewed the committed change against the brief and it matches exactly. Accept as it stands.",
  revise: "I reviewed the committed change against the brief and it does not match. Revise: the message differs from the approved text.",
};

async function main() {
  const { sessionId } = parseRunnerArgs(process.argv);
  const workspace = parseWorkspace(process.argv);
  const reviewRelative = process.env.QUIRKS_BOUNDED_REVIEW_PATH ?? ".quirks/reviews/review.md";
  const reviewPath = path.join(workspace, reviewRelative);
  await mkdir(path.dirname(reviewPath), { recursive: true });

  // Allows a test to drive a withheld approval through the real acceptance path.
  const verdict = process.env.QUIRKS_BOUNDED_REVIEWER_VERDICT ?? "accept";
  const recommendation = RECOMMENDATIONS[verdict] ?? RECOMMENDATIONS.accept;
  await writeFile(reviewPath, `# Bounded review\n\n${recommendation}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: sessionId })}\n`);
  process.stdout.write(`${JSON.stringify({
    type: "item.completed",
    item: { id: "item_0", type: "agent_message", text: recommendation },
  })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "turn.completed" })}\n`);
}

await main();
