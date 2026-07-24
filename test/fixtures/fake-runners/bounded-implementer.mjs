import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// A claude job has no --output-schema/-o equivalent, so it learns its envelope
// path from the brief. The brief is the positional prompt, which now precedes
// the variadic --add-dir rather than trailing it (QK-RUN-007).
async function writeDeclaredEnvelope(argv) {
  const briefPath = argv.find((entry) => entry.endsWith(".md"));
  if (!briefPath) return;
  let envelopePath;
  try {
    const brief = await readFile(briefPath, "utf8");
    envelopePath = brief.match(/write your result envelope JSON to exactly this path: (.+)$/m)?.[1]?.trim();
  } catch {
    return;
  }
  if (!envelopePath) return;
  await mkdir(path.dirname(envelopePath), { recursive: true });
  const verdict = /reviewer/i.test(envelopePath) ? "accept" : null;
  const envelope = { status: "success", verdict, sessionHandle: null, artifactPaths: [envelopePath], failure: null };
  await writeFile(envelopePath, `${JSON.stringify(envelope)}\n`, "utf8");
}

function parseWorkspace(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--add-dir" && argv[index + 1]) return argv[index + 1];
    if (token === "-C" && argv[index + 1]) return argv[index + 1];
    if (token === "--workspace" && argv[index + 1]) return argv[index + 1];
  }
  return process.cwd();
}

function emitInit(sessionId) {
  process.stdout.write(`${JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
  })}\n`);
}

function emitSuccess(sessionId) {
  process.stdout.write(`${JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    result: "Done.",
  })}\n`);
}

async function writeArtifact(outDir) {
  if (!outDir) return;
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "result.json"), '{"status":"ok"}\n', "utf8");
}

async function main() {
  const workspace = parseWorkspace(process.argv);
  const message = process.env.QUIRKS_BOUNDED_APPROVED_MESSAGE ?? "Quirks bounded campaign accepted.";
  const messagePath = path.join(workspace, "src", "message.txt");
  await writeFile(messagePath, message, "utf8");
  await execFileAsync("git", ["-C", workspace, "add", "src/message.txt"]);
  await execFileAsync("git", [
    "-C",
    workspace,
    "-c",
    "user.email=bounded@quirks.test",
    "-c",
    "user.name=Bounded Fixture",
    "commit",
    "-m",
    "bounded campaign implementer",
  ]);
  await writeArtifact(process.env.QUIRKS_FAKE_RUNNER_OUTDIR);
  await writeDeclaredEnvelope(process.argv);
  emitInit("bounded-implementer");
  emitSuccess("bounded-implementer");
}

await main();
