// Resolves how to spawn Electron for this workspace.
//
// Mirrored from t3code's apps/desktop/scripts/electron-launcher.mjs, trimmed
// to the two parts that are about launching rather than branding: repairing
// the runtime and the Linux sandbox fallback. t3code's remaining ~300 lines
// clone Electron.app into a renamed bundle and rewrite its Info.plist so the
// macOS Dock says "T3 Code (Dev)" instead of "Electron"; that is cosmetics
// bought with plist surgery and LaunchServices registration, and the window
// title already carries the product name.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const scriptDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const hostPlatform = NodeOS.platform();

export const desktopDir = NodePath.resolve(scriptDir, "..");
export const MAIN_ENTRY = "dist-electron/main.cjs";
export const PRELOAD_ENTRY = "dist-electron/preload.cjs";

export function resolveElectronBinaryPath({
  ensureRuntime = ensureElectronRuntime,
  createRequire = NodeModule.createRequire,
  moduleUrl = import.meta.url,
} = {}) {
  ensureRuntime();
  return createRequire(moduleUrl)("electron");
}

function isLinuxSetuidSandboxConfigured(electronBinaryPath) {
  if (hostPlatform !== "linux") {
    return true;
  }

  try {
    const sandboxStat = NodeFS.statSync(
      NodePath.join(NodePath.dirname(electronBinaryPath), "chrome-sandbox"),
    );
    return sandboxStat.uid === 0 && (sandboxStat.mode & 0o4777) === 0o4755;
  } catch {
    return false;
  }
}

function resolveLinuxSandboxArgs(electronBinaryPath) {
  if (isLinuxSetuidSandboxConfigured(electronBinaryPath)) {
    return [];
  }

  console.warn(
    "[desktop-launcher] Electron chrome-sandbox is not root-owned with mode 4755; launching with --no-sandbox.",
  );
  return ["--no-sandbox"];
}

export function resolveElectronLaunchCommand(args = []) {
  const electronPath = resolveElectronBinaryPath();
  return {
    electronPath,
    args: [...resolveLinuxSandboxArgs(electronPath), ...args],
  };
}

/**
 * Spawns Electron on the built main bundle and mirrors its exit. Every entry
 * point goes through here so no script can leave a stray window behind.
 */
export function runElectron({ extraArgs = [], env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  // Set by vite-plus/vitest tooling; it would turn Electron into a bare Node.
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const command = resolveElectronLaunchCommand([...extraArgs, MAIN_ENTRY]);
  const child = NodeChildProcess.spawn(command.electronPath, command.args, {
    stdio: "inherit",
    cwd: desktopDir,
    env: childEnv,
  });

  const forwardSignal = (signal) => () => {
    child.kill(signal);
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    process.on(signal, forwardSignal(signal));
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  return child;
}
