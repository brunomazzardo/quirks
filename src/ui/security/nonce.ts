import { randomBytes } from "node:crypto";

export function createResponseNonce(): string {
  return randomBytes(18).toString("base64url");
}
