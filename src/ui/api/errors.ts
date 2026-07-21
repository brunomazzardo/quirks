import type { ServerResponse } from "node:http";

export const UNAUTHORIZED_BODY = { schemaVersion: 1, result: "invalid" } as const;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
