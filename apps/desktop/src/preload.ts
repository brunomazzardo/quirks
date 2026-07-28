// Sandboxed preload. Mirrors t3code's src/preload.ts shape — a single
// contextBridge.exposeInMainWorld call — trimmed to the identification-only
// bridge described in bridge.ts (no Clerk bridge, no IPC channels yet).

import { contextBridge } from "electron";

import { DESKTOP_BRIDGE_KEY, type QuirksDesktopBridge } from "./bridge.ts";

const bridge: QuirksDesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node,
  },
};

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, bridge);
