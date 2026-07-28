// Repairs a half-installed Electron runtime before anything tries to launch it.
//
// Mirrored from t3code's apps/desktop/scripts/ensure-electron-runtime.mjs. It
// earns its keep here: this workspace's node_modules/electron currently ships
// dist/Electron.app but no path.txt, which is exactly the state `require
// ("electron")` cannot resolve. Trimmed to the darwin/linux/win32 cases without
// t3code's oxlint pragmas.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const require = NodeModule.createRequire(import.meta.url);
const hostPlatform = NodeOS.platform();
const hostArch = NodeOS.arch();

function getPlatformPath() {
  switch (hostPlatform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(`Electron builds are not available on platform: ${hostPlatform}`);
  }
}

function ensureExecutable(filePath) {
  if (hostPlatform !== "win32") {
    NodeFS.chmodSync(filePath, 0o755);
  }
}

// `require("electron")` reads this file to find the binary; npm lifecycle
// scripts that are skipped or interrupted leave it missing.
function repairPathFile(electronDir, platformPath) {
  const pathFile = NodePath.join(electronDir, "path.txt");
  const currentPath = NodeFS.existsSync(pathFile)
    ? NodeFS.readFileSync(pathFile, "utf8")
    : undefined;

  if (currentPath !== platformPath) {
    NodeFS.writeFileSync(pathFile, platformPath);
  }
}

function getRequiredRuntimePaths(electronDir, platformPath) {
  const paths = [NodePath.join(electronDir, "dist", platformPath)];

  if (hostPlatform === "darwin") {
    paths.push(
      NodePath.join(electronDir, "dist", "Electron.app", "Contents", "Info.plist"),
      NodePath.join(
        electronDir,
        "dist",
        "Electron.app",
        "Contents",
        "Frameworks",
        "Electron Framework.framework",
        "Electron Framework",
      ),
    );
  }

  return paths;
}

// A Git LFS pointer or a truncated download leaves a file of the right name
// that is not an executable; check the magic rather than mere existence.
function isMachO(filePath) {
  if (hostPlatform !== "darwin") {
    return true;
  }

  const result = NodeChildProcess.spawnSync("file", ["-b", filePath], { encoding: "utf8" });
  return result.status === 0 && result.stdout.includes("Mach-O");
}

function missingRuntimePaths(electronDir, platformPath) {
  return getRequiredRuntimePaths(electronDir, platformPath).filter(
    (runtimePath) => !NodeFS.existsSync(runtimePath),
  );
}

function invalidRuntimePaths(electronDir, platformPath) {
  if (hostPlatform !== "darwin") {
    return [];
  }

  return [
    NodePath.join(electronDir, "dist", platformPath),
    NodePath.join(
      electronDir,
      "dist",
      "Electron.app",
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Electron Framework",
    ),
  ].filter((runtimePath) => NodeFS.existsSync(runtimePath) && !isMachO(runtimePath));
}

function runChecked(command, args) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
  );
}

function installElectronRuntime(electronDir, version) {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "quirks-electron-"));
  const zipPath = NodePath.join(tempDir, `electron-v${version}-${hostPlatform}-${hostArch}.zip`);

  try {
    runChecked("curl", [
      "-fsSL",
      `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-${hostPlatform}-${hostArch}.zip`,
      "-o",
      zipPath,
    ]);
    if (hostPlatform === "darwin") {
      // ditto preserves the framework's symlinks and code signature; unzip does not.
      runChecked("ditto", ["-x", "-k", zipPath, NodePath.join(electronDir, "dist")]);
    } else {
      runChecked("python3", [
        "-c",
        "import os, sys, zipfile; os.makedirs(sys.argv[2], exist_ok=True); zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
        zipPath,
        NodePath.join(electronDir, "dist"),
      ]);
    }
  } finally {
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function ensureElectronRuntime() {
  const electronPackageJsonPath = require.resolve("electron/package.json");
  const electronPackageJson = JSON.parse(NodeFS.readFileSync(electronPackageJsonPath, "utf8"));
  const electronDir = NodePath.dirname(electronPackageJsonPath);
  const platformPath = getPlatformPath();
  const electronPath = NodePath.join(electronDir, "dist", platformPath);

  if (
    missingRuntimePaths(electronDir, platformPath).length > 0 ||
    invalidRuntimePaths(electronDir, platformPath).length > 0
  ) {
    NodeFS.rmSync(NodePath.join(electronDir, "dist"), { recursive: true, force: true });
    NodeFS.rmSync(NodePath.join(electronDir, "path.txt"), { force: true });
    installElectronRuntime(electronDir, electronPackageJson.version);
  }

  const missingAfterInstall = missingRuntimePaths(electronDir, platformPath);
  const invalidAfterInstall = invalidRuntimePaths(electronDir, platformPath);
  if (missingAfterInstall.length > 0 || invalidAfterInstall.length > 0) {
    throw new Error(
      [
        "Electron runtime is incomplete after install.",
        `Missing:\n${missingAfterInstall.map((runtimePath) => `- ${runtimePath}`).join("\n")}`,
        `Invalid:\n${invalidAfterInstall.map((runtimePath) => `- ${runtimePath}`).join("\n")}`,
      ].join("\n"),
    );
  }

  ensureExecutable(electronPath);
  repairPathFile(electronDir, platformPath);

  return electronPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${ensureElectronRuntime()}\n`);
}
