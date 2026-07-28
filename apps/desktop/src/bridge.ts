// The renderer-facing surface of the Electron shell.
//
// t3code exposes a large `desktopBridge` (SSH, WSL, tailscale, Clerk, backend
// exposure, previews, menus). None of that exists in Quirks — the workbench is
// a loopback single-user tool and QK-WB-002 only has to host apps/web. So the
// bridge starts as pure identification: enough for the web app to know it is
// running inside the shell rather than a browser tab. IPC channels arrive with
// the tasks that actually need them.
//
// Declared here rather than in @quirks/contracts because it describes the
// desktop shell's own boundary, not the client/server wire contract.

export interface QuirksDesktopVersions {
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

export interface QuirksDesktopBridge {
  readonly isDesktop: true;
  readonly platform: NodeJS.Platform;
  readonly versions: QuirksDesktopVersions;
}

/** The `window` key the preload exposes the bridge under. */
export const DESKTOP_BRIDGE_KEY = "quirksDesktop";
