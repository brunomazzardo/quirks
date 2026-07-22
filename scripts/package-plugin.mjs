import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { validateSkills } from "./validate-skills.mjs";

const CREDENTIAL_PATTERN = /(?:api[_-]?key|secret|password|bearer)\s*[=:]\s*\S+/i;
const HOME_PATH_PATTERN = /(?:\/Users\/|\/home\/)[^/\s]+/;
const TASK_COMMAND_PATTERN = /pnpm\s+(?:test|check|lint)\b/;

export const PACKAGE_INCLUDE = [
  ".codex-plugin/plugin.json",
  "skills",
  "references/parent-protocol.md",
  "references/model-routing.md",
  "references/security-boundaries.md",
  "references/dogfood.md",
  "references/hosts",
  "references/runners",
];

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

/**
 * @param {string} root
 * @returns {Promise<{ ok: boolean; files: string[]; errors: string[] }>}
 */
export async function collectPackageFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const errors = [];

  for (const relative of PACKAGE_INCLUDE) {
    const absolute = path.join(root, relative);
    const info = await stat(absolute).catch(() => null);
    if (!info) {
      errors.push(`missing package path: ${relative}`);
      continue;
    }
    if (info.isDirectory()) {
      for (const file of await walkFiles(absolute)) {
        files.push(path.relative(root, file));
      }
    } else {
      files.push(relative);
    }
  }

  return { ok: errors.length === 0, files: files.toSorted(), errors };
}

/**
 * @param {string} root
 * @param {string[]} files
 */
export async function scanShippedArtifacts(root, files) {
  /** @type {string[]} */
  const errors = [];
  for (const relative of files) {
    const absolute = path.join(root, relative);
    const content = await readFile(absolute, "utf8").catch(() => null);
    if (content === null) continue;
    if (CREDENTIAL_PATTERN.test(content)) errors.push(`credential-shaped content in ${relative}`);
    if (HOME_PATH_PATTERN.test(content)) errors.push(`absolute home path in ${relative}`);
    if (TASK_COMMAND_PATTERN.test(content) && relative.startsWith("skills/")) {
      errors.push(`project-specific task command in ${relative}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {{ root?: string }} [options]
 */
export async function validatePackage({ root = process.cwd() } = {}) {
  const skills = await validateSkills({ root });
  const collected = await collectPackageFiles(root);
  const scan = collected.ok ? await scanShippedArtifacts(root, collected.files) : { ok: false, errors: [] };
  const errors = [
    ...skills.errors,
    ...(skills.ok ? [] : ["skills validation failed"]),
    ...collected.errors,
    ...scan.errors,
  ];
  return {
    ok: skills.ok && collected.ok && scan.ok,
    skills,
    collected,
    scan,
    errors,
  };
}

/**
 * @param {string} filePath
 */
async function sha256File(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/**
 * @param {{ root?: string; outputPath: string }} options
 */
export async function buildPluginTarball({ root = process.cwd(), outputPath }) {
  const validation = await validatePackage({ root });
  if (!validation.ok) {
    throw new Error(`package validation failed: ${validation.errors.join("; ")}`);
  }

  const manifest = {
    schemaVersion: 1,
    protocol: "quirks-plugin-package-v1",
    name: "quirks",
    files: [],
    digest: "",
  };

  for (const relative of validation.collected.files) {
    const absolute = path.join(root, relative);
    const digest = await sha256File(absolute);
    manifest.files.push({ path: relative.replaceAll("\\", "/"), digest });
  }

  manifest.digest = createHash("sha256")
    .update(JSON.stringify(manifest.files))
    .digest("hex");

  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const gz = createGzip({ level: 9 });
  const chunks = [];
  gz.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    gz.on("end", resolve);
    gz.on("error", reject);
  });
  gz.end(payload);
  await done;
  await writeFile(outputPath, Buffer.concat(chunks));
  return manifest;
}
