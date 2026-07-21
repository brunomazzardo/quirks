import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { escapeAttribute } from "./security/escape.js";
import { UI_CSS } from "./styles.js";

const CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function matchShellRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "/campaigns") return true;
  const preflight = /^\/preflight\/([^/]+)$/.exec(pathname);
  if (preflight) return CAMPAIGN_ID.test(decodeURIComponent(preflight[1] ?? ""));
  const campaign = /^\/campaigns\/([^/]+)$/.exec(pathname);
  if (campaign) return CAMPAIGN_ID.test(decodeURIComponent(campaign[1] ?? ""));
  const history = /^\/tasks\/([^/]+)\/history$/.exec(pathname);
  if (history) return TASK_ID.test(decodeURIComponent(history[1] ?? ""));
  return false;
}

export function renderShell(options: { nonce: string; clientScript: string }): string {
  const safeNonce = escapeAttribute(options.nonce);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Quirks</title><style nonce="${safeNonce}">${UI_CSS}</style></head><body><div id="app"></div><script nonce="${safeNonce}">${options.clientScript}</script></body></html>`;
}

export async function loadClientBundle(): Promise<string> {
  const bundlePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ui/client.bundle.js");
  try {
    return await readFile(bundlePath, "utf8");
  } catch {
    return "";
  }
}
