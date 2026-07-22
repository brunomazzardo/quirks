import os from "node:os";
import path from "node:path";
import { readlink } from "node:fs/promises";
import { installClaudeHost } from "../claude/install.mjs";
import { uninstallClaudeHost } from "../claude/uninstall.mjs";
import { discoverClaudeSkills } from "../claude/discover.mjs";
import { installCodexHost } from "../codex/install.mjs";
import { uninstallCodexHost } from "../codex/uninstall.mjs";
import { discoverCodexSkills } from "../codex/discover.mjs";
import { installCursorHost } from "../cursor/install.mjs";
import { uninstallCursorHost } from "../cursor/uninstall.mjs";
import { discoverCursorSkills } from "../cursor/discover.mjs";
import { pathKind } from "./link-install.mjs";
import { validateSkills } from "../../scripts/validate-skills.mjs";

/** @typedef {"claude" | "codex" | "cursor"} QuirksHost */

export const HOSTS = /** @type {const} */ (["claude", "codex", "cursor"]);

/**
 * @returns {{ claude: string; codex: string; cursor: string }}
 */
export function defaultHostRoots() {
  return {
    claude: process.env.QUIRKS_PLUGINS_DIR ?? path.join(os.homedir(), ".claude", "plugins"),
    codex: process.env.QUIRKS_CODEX_PLUGINS_DIR ?? path.join(os.homedir(), ".codex", "plugins"),
    cursor: process.env.QUIRKS_CURSOR_SKILLS_DIR ?? path.join(os.homedir(), ".cursor", "skills"),
  };
}

/**
 * @param {string} sourceRoot
 */
export async function loadCanonicalSkillIds(sourceRoot) {
  const validation = await validateSkills({ root: sourceRoot });
  return validation.skills.map((skill) => skill.id).toSorted();
}

/**
 * @param {string} linkPath
 */
async function resolveInstalledLayoutRoot(linkPath) {
  const resolvedLinkPath = path.resolve(linkPath);
  const kind = await pathKind(resolvedLinkPath);
  if (kind === "symlink") {
    const target = await readlink(resolvedLinkPath);
    return path.resolve(path.dirname(resolvedLinkPath), target);
  }
  if (kind === "directory") return resolvedLinkPath;
  throw new Error(`installed layout missing at ${resolvedLinkPath}`);
}

/**
 * @param {QuirksHost} host
 * @param {string} hostRoot
 */
export async function discoverInstalledSkillIds(host, hostRoot) {
  const layoutRoot = await resolveInstalledLayoutRoot(path.join(hostRoot, "quirks"));
  const discover = {
    claude: discoverClaudeSkills,
    codex: discoverCodexSkills,
    cursor: discoverCursorSkills,
  }[host];
  const result = await discover({ layoutRoot });
  return result.skills.map((skill) => skill.id).toSorted();
}

/**
 * @param {{ sourceRoot: string; roots: { claude: string; codex: string; cursor: string } }} input
 */
export async function installAllHosts({ sourceRoot, roots }) {
  const resolvedSource = path.resolve(sourceRoot);
  return [
    { host: "claude", ...(await installClaudeHost({ sourceRoot: resolvedSource, pluginsDir: roots.claude })) },
    { host: "codex", ...(await installCodexHost({ sourceRoot: resolvedSource, pluginsDir: roots.codex })) },
    { host: "cursor", ...(await installCursorHost({ sourceRoot: resolvedSource, skillsDir: roots.cursor })) },
  ];
}

/**
 * @param {{ sourceRoot: string; roots: { claude: string; codex: string; cursor: string } }} input
 */
export async function uninstallAllHosts({ sourceRoot, roots }) {
  const resolvedSource = path.resolve(sourceRoot);
  return [
    { host: "claude", ...(await uninstallClaudeHost({ pluginsDir: roots.claude, sourceRoot: resolvedSource })) },
    { host: "codex", ...(await uninstallCodexHost({ pluginsDir: roots.codex, sourceRoot: resolvedSource })) },
    { host: "cursor", ...(await uninstallCursorHost({ skillsDir: roots.cursor, sourceRoot: resolvedSource })) },
  ];
}
