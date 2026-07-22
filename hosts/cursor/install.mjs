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
export function defaultCursorSkillsDir() {
  return process.env.QUIRKS_CURSOR_SKILLS_DIR ?? path.join(os.homedir(), ".cursor", "skills");
}

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

if (isExecutedDirectly(import.meta.url)) {
  const options = parseHostCliArgs(process.argv.slice(2));
  const result = await installCursorHost({
    sourceRoot: options.source ?? defaultSourceRoot(import.meta.url),
    skillsDir: options.root ?? defaultCursorSkillsDir(),
  });
  writeHostCliResult(result);
}
