import os from "node:os";
import path from "node:path";
import { uninstallManagedLink } from "../shared/link-install.mjs";
import {
  defaultSourceRoot,
  isExecutedDirectly,
  parseHostCliArgs,
  writeHostCliResult,
} from "../shared/host-cli.mjs";
import { defaultCodexPluginsDir } from "./install.mjs";

/**
 * @param {{ pluginsDir: string; sourceRoot?: string }} input
 */
export async function uninstallCodexHost({ pluginsDir, sourceRoot }) {
  const destination = path.join(pluginsDir, "quirks");
  return uninstallManagedLink({
    destination,
    expectedSource: sourceRoot ? path.resolve(sourceRoot) : undefined,
  });
}

if (isExecutedDirectly(import.meta.url)) {
  const options = parseHostCliArgs(process.argv.slice(2));
  const result = await uninstallCodexHost({
    pluginsDir: options.root ?? defaultCodexPluginsDir(),
    sourceRoot: options.source ?? defaultSourceRoot(import.meta.url),
  });
  writeHostCliResult(result);
}
