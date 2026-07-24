import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Result envelope path a brief declares, for runners whose CLI cannot enforce
 * it (claude and cursor). A real job learns its path exactly this way, so the
 * fakes must too: deriving it any other way would let a runner pass here while
 * failing against the real CLI, which is the gap QK-RUN-007 closed.
 */
export async function declaredEnvelopePath(briefPath) {
  if (!briefPath) return undefined;
  try {
    const brief = await readFile(briefPath, "utf8");
    const match = brief.match(/write your result envelope JSON to exactly this path: (.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/**
 * Verdict a reviewer fake must state. Acceptance is never inferred from a
 * silent success, so a fake standing in for a reviewer has to say it approves
 * just as a real one does. Role is read off the job-unique envelope path.
 */
export function verdictForEnvelopePath(envelopePath) {
  return envelopePath && /reviewer/i.test(envelopePath) ? "accept" : null;
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

/** Write an envelope to an absolute, brief-declared path. */
export async function writeDeclaredEnvelope(envelopePath, envelope = {}) {
  if (!envelopePath) return undefined;
  await mkdir(path.dirname(envelopePath), { recursive: true });
  const payload = {
    status: "success",
    verdict: verdictForEnvelopePath(envelopePath),
    sessionHandle: null,
    artifactPaths: [envelopePath],
    failure: null,
    ...envelope,
  };
  await writeFile(envelopePath, `${JSON.stringify(payload)}\n`, "utf8");
  return envelopePath;
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
