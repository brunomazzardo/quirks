import type { IncomingMessage } from "node:http";
import { QuirksError } from "../core/errors.js";
import type { LoopbackAuthority } from "./authority.js";

export function assertLoopbackRequest(req: IncomingMessage, authority: LoopbackAuthority): void {
  if (req.headers.host !== authority.hostHeader) {
    throw new QuirksError("PROTOCOL_VIOLATION", "UI_FORBIDDEN");
  }
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new QuirksError("PROTOCOL_VIOLATION", "UI_PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", "UI_INVALID_JSON");
  }
}
