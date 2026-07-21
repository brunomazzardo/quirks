import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

export async function writeArtifact(outDir, contents = '{"status":"ok"}\n') {
  if (!outDir) return undefined;
  await mkdir(outDir, { recursive: true });
  const artifactPath = path.join(outDir, "result.json");
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
