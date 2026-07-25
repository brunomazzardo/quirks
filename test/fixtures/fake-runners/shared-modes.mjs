import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Workspace the runner was pointed at, however its CLI spells that. */
export function workspaceFromArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    if ((argv[index] === "-C" || argv[index] === "--workspace") && argv[index + 1]) return argv[index + 1];
  }
  return process.cwd();
}

/** Whether this invocation was granted write authority, per each CLI's posture flag. */
export function canWrite(argv) {
  return argv.includes("--dangerously-skip-permissions")
    || argv.includes("--force")
    || argv.includes("workspace-write");
}

/**
 * Commit something, as a real implementer does.
 *
 * The fakes used to write an artifact and never touch git, so every CLI-level
 * campaign test ran with a worktree still sitting at the campaign base — the
 * exact state the supervisor now refuses to review. Best-effort: a non-git
 * workspace simply skips.
 */
export async function commitWork(argv) {
  if (!canWrite(argv)) return undefined;
  const workspace = workspaceFromArgv(argv);
  try {
    const marker = path.join(workspace, "fake-runner-work.txt");
    await writeFile(marker, `work by fake runner at ${process.pid}\n`, "utf8");
    await execFileAsync("git", ["-C", workspace, "add", "fake-runner-work.txt"]);
    await execFileAsync("git", [
      "-C", workspace,
      "-c", "user.email=fake@quirks.test",
      "-c", "user.name=Fake Runner",
      "commit", "-m", "fake runner implementer work",
    ]);
    const { stdout } = await execFileAsync("git", ["-C", workspace, "rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Prose a fake reviewer states, so a transcript carries a real recommendation
 * for the interpretation seam to read. The wording is deliberately the awkward
 * kind a real reviewer produced on 2026-07-25: the word "accepted" appears
 * inside a negation, so anything scanning for keywords gets it backwards.
 */
export const FAKE_REVIEW_REVISE_PROSE =
  "I found an off-by-one at sum.js:3: the loop bound uses <= where it should use <. "
  + "**Revise.** I don't think this should be accepted as it stands.";

export const FAKE_REVIEW_ACCEPT_PROSE =
  "I read the diff and found nothing that must be fixed first. **Accept as it stands.**";

/**
 * Whether this invocation is a review, learned the way a real runner learns it:
 * from the brief it was handed. Reviewer briefs live at `<task>.reviewer.md`
 * and say "Do not modify code"; codex receives the brief inlined, so the text
 * is checked as well as the path.
 *
 * An implementer that states a verdict is a bad fixture to keep near anything
 * that reads verdicts (independent claude review, 2026-07-25).
 */
export function isReviewJob(argv) {
  return argv.some((entry) =>
    /\.reviewer\.md\b/.test(entry) || /do not modify code/i.test(entry));
}

/** Brief path from a claude argv: the positional prompt, which is a file path. */
export function briefPathFromArgv(argv) {
  return argv.find((entry) => entry.endsWith(".md"));
}

export function parseRunnerArgs(argv) {
  let mode = "success";
  let sessionId = "11111111-1111-4111-8111-111111111111";
  let resultPath;

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
      continue;
    }
    if (token === "-o" && argv[index + 1]) {
      resultPath = argv[index + 1];
      index += 1;
    }
  }

  return { mode, sessionId, resultPath };
}

export async function writeArtifact(outDir, contents = '{"status":"ok"}\n', fileName = "result.json") {
  if (!outDir) return undefined;
  await mkdir(outDir, { recursive: true });
  const artifactPath = path.join(outDir, fileName);
  await writeFile(artifactPath, contents, "utf8");
  return artifactPath;
}

export async function writePartialArtifact(outDir) {
  if (!outDir) return undefined;
  await mkdir(outDir, { recursive: true });
  const artifactPath = path.join(outDir, "result.json");
  await writeFile(artifactPath, '{"status":"partial","done":false}\n', "utf8");
  return artifactPath;
}

export function oversizedPayload() {
  return "x".repeat(17 * 1024 * 1024);
}

export function hangForever() {
  setInterval(() => {}, 60_000);
}

export async function wedgeAfterWork(outDir, emitSuccess) {
  await writeArtifact(outDir);
  hangForever();
  emitSuccess();
}
