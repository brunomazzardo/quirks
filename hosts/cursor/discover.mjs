import path from "node:path";
import { discoverSkillIds } from "../shared/link-install.mjs";

/**
 * @param {{ layoutRoot: string }} input
 */
export async function discoverCursorSkills({ layoutRoot }) {
  const ids = await discoverSkillIds(layoutRoot);
  return {
    host: "cursor",
    layoutRoot: path.resolve(layoutRoot),
    skills: ids.map((id) => ({ id, path: path.join("skills", id) })),
  };
}
