import path from "node:path";
import { installManagedLink } from "../shared/link-install.mjs";

/**
 * @param {{ sourceRoot?: string; skillsDir: string; force?: boolean }} input
 */
export async function installCursorHost({ sourceRoot = process.cwd(), skillsDir, force = false }) {
  const destination = path.join(skillsDir, "quirks");
  return installManagedLink({
    sourceRoot: path.resolve(sourceRoot),
    destination,
    marker: "cursor-managed-link",
    force,
  });
}
