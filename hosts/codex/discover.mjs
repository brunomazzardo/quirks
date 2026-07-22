import path from "node:path";
import { discoverSkillIds } from "../shared/link-install.mjs";

/**
 * @param {{ layoutRoot: string }} input
 */
export async function discoverCodexSkills({ layoutRoot }) {
  const ids = await discoverSkillIds(layoutRoot);
  return {
    host: "codex",
    layoutRoot: path.resolve(layoutRoot),
    skills: ids.map((id) => ({ id, path: path.join("skills", id) })),
  };
}
