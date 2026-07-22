import path from "node:path";
import { uninstallManagedLink } from "../shared/link-install.mjs";
import {
  defaultSourceRoot,
  isExecutedDirectly,
  parseHostCliArgs,
  writeHostCliResult,
} from "../shared/host-cli.mjs";
import { defaultCursorSkillsDir } from "./install.mjs";

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

if (isExecutedDirectly(import.meta.url)) {
  const options = parseHostCliArgs(process.argv.slice(2));
  const result = await uninstallCursorHost({
    skillsDir: options.root ?? defaultCursorSkillsDir(),
    sourceRoot: options.source ?? defaultSourceRoot(import.meta.url),
  });
  writeHostCliResult(result);
}
