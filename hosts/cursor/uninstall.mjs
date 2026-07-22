import path from "node:path";
import { uninstallManagedLink } from "../shared/link-install.mjs";

/**
 * @param {{ skillsDir: string; sourceRoot?: string }} input
 */
export async function uninstallCursorHost({ skillsDir, sourceRoot }) {
  const destination = path.join(skillsDir, "quirks");
  return uninstallManagedLink({
    destination,
    expectedSource: sourceRoot ? path.resolve(sourceRoot) : undefined,
  });
}
