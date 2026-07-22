import path from "node:path";
import { uninstallManagedLink } from "../shared/link-install.mjs";

/**
 * @param {{ pluginsDir: string; sourceRoot?: string }} input
 */
export async function uninstallClaudeHost({ pluginsDir, sourceRoot }) {
  const destination = path.join(pluginsDir, "quirks");
  return uninstallManagedLink({
    destination,
    expectedSource: sourceRoot ? path.resolve(sourceRoot) : undefined,
  });
}
