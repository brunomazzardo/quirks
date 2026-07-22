import os from "node:os";
import path from "node:path";
import { installManagedLink } from "../shared/link-install.mjs";
import {
  defaultSourceRoot,
  isExecutedDirectly,
  parseHostCliArgs,
  writeHostCliResult,
} from "../shared/host-cli.mjs";

/**
 * @returns {string}
 */
export function defaultCodexPluginsDir() {
  return process.env.QUIRKS_CODEX_PLUGINS_DIR ?? path.join(os.homedir(), ".codex", "plugins");
}

/**
 * @param {{ sourceRoot?: string; pluginsDir: string; force?: boolean }} input
 */
export async function installCodexHost({ sourceRoot = process.cwd(), pluginsDir, force = false }) {
  const destination = path.join(pluginsDir, "quirks");
  return installManagedLink({
    sourceRoot: path.resolve(sourceRoot),
    destination,
    marker: "codex-plugin",
    force,
  });
}

if (isExecutedDirectly(import.meta.url)) {
  const options = parseHostCliArgs(process.argv.slice(2));
  const result = await installCodexHost({
    sourceRoot: options.source ?? defaultSourceRoot(import.meta.url),
    pluginsDir: options.root ?? defaultCodexPluginsDir(),
  });
  writeHostCliResult(result);
}
