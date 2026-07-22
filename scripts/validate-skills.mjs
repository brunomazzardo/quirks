import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const CREDENTIAL_PATTERN = /(?:api[_-]?key|secret|password|bearer)\s*[=:]\s*\S+/i;
const HOME_PATH_PATTERN = /(?:\/Users\/|\/home\/)[^/\s]+/;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_NAME_LENGTH = 64;

/**
 * @typedef {{ id: string; path: string; ok: boolean; errors: string[] }} SkillValidation
 * @typedef {{ ok: boolean; name?: string; skillsPath?: string; errors: string[] }} PluginValidation
 * @typedef {{ ok: boolean; skills: SkillValidation[]; plugin: PluginValidation; errors: string[] }} SkillValidationReport
 */

/**
 * @param {string} content
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return fields;
}

/**
 * @param {string} directory
 */
async function walkFiles(directory) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const MARKDOWN_REFERENCE_PATTERN = /`([^`\n]+\.md)`/g;

/**
 * @param {string} content
 */
function extractMarkdownReferences(content) {
  /** @type {string[]} */
  const references = [];
  for (const match of content.matchAll(MARKDOWN_REFERENCE_PATTERN)) {
    references.push(match[1]);
  }
  return references;
}

/**
 * @param {string} filePath
 * @param {string} skillRoot
 * @param {string} packageRoot
 */
async function validateMarkdownReferences(filePath, skillRoot, packageRoot) {
  /** @type {string[]} */
  const errors = [];
  const relativeFile = path.relative(packageRoot, filePath);
  const content = await readFile(filePath, "utf8");
  for (const reference of extractMarkdownReferences(content)) {
    if (path.isAbsolute(reference)) {
      errors.push(`absolute markdown reference \`${reference}\` in ${relativeFile}`);
      continue;
    }
    const resolved = path.resolve(skillRoot, reference);
    const packageRootWithSep = `${path.resolve(packageRoot)}${path.sep}`;
    if (!resolved.startsWith(packageRootWithSep) && resolved !== path.resolve(packageRoot)) {
      errors.push(`markdown reference escapes package root: \`${reference}\` in ${relativeFile}`);
      continue;
    }
    const fileStat = await stat(resolved).catch(() => null);
    if (!fileStat?.isFile()) {
      errors.push(`missing markdown reference \`${reference}\` in ${relativeFile}`);
    }
  }
  return errors;
}

/**
 * @param {string} filePath
 * @param {string} root
 */
async function scanSkillFile(filePath, root) {
  /** @type {string[]} */
  const errors = [];
  const content = await readFile(filePath, "utf8");
  if (CREDENTIAL_PATTERN.test(content)) errors.push(`credential-shaped content in ${path.relative(root, filePath)}`);
  if (HOME_PATH_PATTERN.test(content)) errors.push(`absolute home path in ${path.relative(root, filePath)}`);
  if (path.isAbsolute(content)) errors.push(`absolute path reference in ${path.relative(root, filePath)}`);
  return errors;
}

/**
 * @param {{ root?: string }} [options]
 * @returns {Promise<SkillValidationReport>}
 */
export async function validateSkills({ root = process.cwd() } = {}) {
  /** @type {string[]} */
  const errors = [];
  const skillsDir = path.join(root, "skills");
  const pluginPath = path.join(root, ".codex-plugin", "plugin.json");

  /** @type {PluginValidation} */
  const plugin = { ok: false, errors: [] };
  try {
    const raw = JSON.parse(await readFile(pluginPath, "utf8"));
    plugin.name = raw.name;
    plugin.skillsPath = path.resolve(root, raw.skills);
    if (raw.name !== "quirks") plugin.errors.push("plugin name must be quirks");
    if (!plugin.skillsPath.endsWith(`${path.sep}skills`)) plugin.errors.push("plugin skills path must resolve to skills/");
    const skillsStat = await stat(plugin.skillsPath).catch(() => null);
    if (!skillsStat?.isDirectory()) plugin.errors.push("plugin skills directory missing");
    plugin.ok = plugin.errors.length === 0;
  } catch (error) {
    plugin.errors.push(`plugin manifest invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  /** @type {SkillValidation[]} */
  const skills = [];
  let entries = [];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    errors.push("skills directory missing");
    return { ok: false, skills, plugin, errors };
  }

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const skillId = entry.name;
    const skillPath = path.join(skillsDir, skillId);
    const skillFile = path.join(skillPath, "SKILL.md");
    /** @type {string[]} */
    const skillErrors = [];
    try {
      const content = await readFile(skillFile, "utf8");
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) skillErrors.push("missing YAML frontmatter");
      else {
        if (!frontmatter.name || frontmatter.name !== skillId) skillErrors.push("frontmatter name must match directory id");
        if (!frontmatter.description) skillErrors.push("frontmatter description required");
        if (frontmatter.description && frontmatter.description.length > MAX_DESCRIPTION_LENGTH) {
          skillErrors.push("description exceeds bounded length");
        }
        if (frontmatter.name && frontmatter.name.length > MAX_NAME_LENGTH) skillErrors.push("name exceeds bounded length");
      }
      const files = await walkFiles(skillPath);
      for (const file of files) {
        skillErrors.push(...await scanSkillFile(file, root));
        if (file.endsWith(".md")) {
          skillErrors.push(...await validateMarkdownReferences(file, skillPath, root));
        }
      }
    } catch {
      skillErrors.push("SKILL.md missing");
    }
    skills.push({ id: skillId, path: skillPath, ok: skillErrors.length === 0, errors: skillErrors });
  }

  const ok = plugin.ok && skills.length > 0 && skills.every((skill) => skill.ok) && errors.length === 0;
  return { ok, skills, plugin, errors };
}
