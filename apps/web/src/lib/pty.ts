// The browser's half of the pty wire (QK-WB-004).
//
import { serviceBaseUrl } from "~/lib/service";

import type {
  PtyClientMessage,
  PtyListResponse,
  PtyServerMessage,
  PtySessionInfo,
} from "@quirks/contracts";

export type { PtyClientMessage, PtyServerMessage, PtySessionInfo };

export interface CreateSessionRequest {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Where a session's socket lives. Same-origin by default — the page's own
 * origin, like every other request the app makes; an explicit base
 * (VITE_QUIRKS_URL) wins when configured. The scheme must track the chosen
 * origin (http→ws, https→wss): an https page opening `ws:` is mixed content,
 * refused by the browser, and the failure is indistinguishable from a daemon
 * that is down.
 */
export function ptySocketUrl(
  sessionId: string,
  pageOrigin: string,
  base: string = serviceBaseUrl(),
): string {
  const chosen = base.trim().length > 0 ? base.trim() : pageOrigin;
  const url = new URL(chosen);
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${url.host}/v1/pty/sessions/${encodeURIComponent(sessionId)}/socket`;
}

async function readError(response: Response, verb: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    /* not JSON — the status is the whole story */
  }
  return `${verb} → HTTP ${response.status}`;
}

export async function createSession(
  request: CreateSessionRequest,
  signal?: AbortSignal,
): Promise<PtySessionInfo> {
  const response = await fetch(`${serviceBaseUrl()}/v1/pty/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await readError(response, "POST /v1/pty/sessions"));
  return (await response.json()) as PtySessionInfo;
}

/**
 * The sessions the daemon currently holds.
 *
 * This route existed from the start and had no caller, which is precisely how a
 * reload came to leak a shell: the page minted a new session every time and the
 * previous one stayed alive in the daemon with nothing able to reach it. Sixteen
 * reloads hit the per-daemon cap and the terminal could not be opened at all
 * until the daemon restarted.
 */
export async function listSessions(signal?: AbortSignal): Promise<readonly PtySessionInfo[]> {
  const response = await fetch(`${serviceBaseUrl()}/v1/pty/sessions`, signal ? { signal } : {});
  if (!response.ok) throw new Error(await readError(response, "GET /v1/pty/sessions"));
  return ((await response.json()) as PtyListResponse).sessions;
}

/** Best-effort: a tab is closing either way, and a session the daemon has
 *  already reaped is not a failure worth showing anyone. */
export async function killSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${serviceBaseUrl()}/v1/pty/sessions/${encodeURIComponent(sessionId)}/kill`, {
      method: "POST",
      keepalive: true,
    });
  } catch {
    /* the daemon is gone, which achieves the same thing */
  }
}

// ---------------------------------------------------------------------------
// one session per tab, exactly once
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<PtySessionInfo>>();

/**
 * Create the session for a tab at most once.
 *
 * React's StrictMode runs every effect twice in development. Without this, the
 * "+" button would spawn two shells and leak one — a bug that never appears in
 * a production build and is therefore exactly the kind that ships. Keying the
 * in-flight promise by the tab's stable key makes the second invocation join
 * the first instead of racing it.
 */
export function ensureSession(
  tabKey: string,
  create: () => Promise<PtySessionInfo>,
): Promise<PtySessionInfo> {
  const existing = inFlight.get(tabKey);
  if (existing !== undefined) return existing;
  const started = create().catch((error: unknown) => {
    // A failed create must not be cached, or Retry could never succeed.
    inFlight.delete(tabKey);
    throw error;
  });
  inFlight.set(tabKey, started);
  return started;
}

/** Forget a tab's session so a fresh one can be created under a new key. */
export function forgetSession(tabKey: string): void {
  inFlight.delete(tabKey);
}

/** Test seam: drop every remembered session. */
export function resetSessionCache(): void {
  inFlight.clear();
}

// ---------------------------------------------------------------------------
// colors
// ---------------------------------------------------------------------------

let probe: CanvasRenderingContext2D | null | undefined;

/**
 * Resolve any CSS color to `#rrggbb`.
 *
 * xterm's theme wants colors it can parse itself, and this app's tokens are
 * `oklch(…)` and `color-mix(…)` (src/index.css) — modern syntax that xterm's
 * own parser does not accept. Rather than maintain a second, hard-coded copy of
 * the palette that could drift from the real one, hand the value to a canvas:
 * the browser understands every color it ships, and reading one pixel back
 * gives the exact sRGB triple it would have painted.
 */
export function cssColorToHex(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  if (probe === undefined) {
    probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  }
  if (probe === null) return fallback;
  try {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000000";
    // An unparseable value leaves fillStyle untouched, so a sentinel tells a
    // real black apart from a value the browser rejected.
    probe.fillStyle = trimmed;
    if (
      probe.fillStyle === "#000000" &&
      !/^(#000000|#000|black|rgb\(0, ?0, ?0\))$/i.test(trimmed)
    ) {
      return fallback;
    }
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}
