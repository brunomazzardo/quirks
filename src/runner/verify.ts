import { readFile, stat } from "node:fs/promises";
import type { RunnerJobResult } from "./types.js";

export interface VerifyJobArtifactsExpectations {
  expectedPaths: readonly string[];
  jsonEnvelopes?: readonly string[];
}

export type VerifyJobArtifactsResult =
  | {
      ok: true;
      artifactPaths: readonly string[];
    }
  | {
      ok: false;
      code: "missing_artifact" | "unreported_artifact" | "invalid_json_envelope";
      message: string;
      path?: string;
    };

interface JsonResultEnvelope {
  schemaVersion?: unknown;
  jobId?: unknown;
  status?: unknown;
}

async function isReadableFile(artifactPath: string): Promise<boolean> {
  try {
    const stats = await stat(artifactPath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function parseJsonEnvelope(raw: string): JsonResultEnvelope | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as JsonResultEnvelope;
  } catch {
    return undefined;
  }
}

function isValidJsonEnvelope(envelope: JsonResultEnvelope, result: RunnerJobResult): boolean {
  return (
    envelope.schemaVersion === 1 &&
    envelope.jobId === result.jobId &&
    typeof envelope.status === "string"
  );
}

export async function verifyJobArtifacts(
  result: RunnerJobResult,
  expectations: VerifyJobArtifactsExpectations,
): Promise<VerifyJobArtifactsResult> {
  const reportedPaths = new Set(result.artifactPaths);

  for (const expectedPath of expectations.expectedPaths) {
    if (!(await isReadableFile(expectedPath))) {
      return {
        ok: false,
        code: "missing_artifact",
        message: `Expected artifact is missing or empty: ${expectedPath}`,
        path: expectedPath,
      };
    }
    if (!reportedPaths.has(expectedPath)) {
      return {
        ok: false,
        code: "unreported_artifact",
        message: `Expected artifact was not reported by job result: ${expectedPath}`,
        path: expectedPath,
      };
    }
  }

  for (const envelopePath of expectations.jsonEnvelopes ?? []) {
    if (!reportedPaths.has(envelopePath) || !(await isReadableFile(envelopePath))) {
      return {
        ok: false,
        code: "missing_artifact",
        message: `Expected JSON result envelope is missing or empty: ${envelopePath}`,
        path: envelopePath,
      };
    }

    const envelope = parseJsonEnvelope(await readFile(envelopePath, "utf8"));
    if (!envelope || !isValidJsonEnvelope(envelope, result)) {
      return {
        ok: false,
        code: "invalid_json_envelope",
        message: `JSON result envelope is malformed or does not match job ${result.jobId}: ${envelopePath}`,
        path: envelopePath,
      };
    }
  }

  return {
    ok: true,
    artifactPaths: [...expectations.expectedPaths],
  };
}
