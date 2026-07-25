import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    result: "Done: I replaced src/message.txt with the approved message and committed it. Accept as it stands.",
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
  emitInit("bounded-implementer");
  emitSuccess("bounded-implementer");
}

await main();
