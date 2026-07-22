import path from "node:path";
import { installManagedLink } from "../shared/link-install.mjs";

/**
 * @param {{ sourceRoot?: string; pluginsDir: string; force?: boolean }} input
 */
export async function installClaudeHost({ sourceRoot = process.cwd(), pluginsDir, force = false }) {
  const destination = path.join(pluginsDir, "quirks");
  return installManagedLink({
    sourceRoot: path.resolve(sourceRoot),
    destination,
    marker: "claude-plugin",
    force,
  });
}
