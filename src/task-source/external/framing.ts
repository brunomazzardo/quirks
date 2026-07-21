import { Readable } from "node:stream";
import { canonicalJson } from "../../core/canonical-json.js";
import { QuirksError } from "../../core/errors.js";

const SECRET_PATTERNS: readonly RegExp[] = [
  /https:\/\/[^/?#]*@[^/?#]/,
  /https:\/\/[^/:]+:[^/@]+@/,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

const STDERR_DIAGNOSTIC_LIMIT = 4_096;

export function formatRequestLine(request: unknown): string {
  return `${canonicalJson(request)}\n`;
}

export function collectBoundedStream(
  stream: Readable,
  maxBytes: number,
  label: "stdout" | "stderr",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        reject(new QuirksError("PROTOCOL_VIOLATION", `${label} exceeds ${maxBytes} bytes`));
        stream.destroy();
        return;
      }
      chunks.push(buffer);
    });

    stream.on("error", (error) => reject(error));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export function parseResponseFrame(stdout: Buffer, maxBytes: number): unknown {
  if (stdout.length === 0) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Adapter produced empty stdout");
  }
  if (stdout.length > maxBytes) {
    throw new QuirksError("PROTOCOL_VIOLATION", `stdout exceeds ${maxBytes} bytes`);
  }

  const newlineIndex = stdout.indexOf(0x0a);
  if (newlineIndex === -1) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Adapter stdout must contain exactly one JSON line");
  }

  const trailing = stdout.subarray(newlineIndex + 1);
  if (trailing.some((byte) => byte !== 0x0a && byte !== 0x0d && byte !== 0x20 && byte !== 0x09)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Adapter stdout contains trailing content after response frame");
  }

  const line = stdout.subarray(0, newlineIndex).toString("utf8").trim();
  if (!line) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Adapter stdout frame is empty");
  }

  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", "Adapter stdout is not valid JSON");
  }
}

export function redactStderr(stderr: Buffer, maxBytes = STDERR_DIAGNOSTIC_LIMIT): string {
  let text = stderr.toString("utf8");
  if (text.length > maxBytes) {
    text = `${text.slice(0, maxBytes)}…`;
  }
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text;
}
