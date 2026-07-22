import { lstat, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} target
 */
export async function pathKind(target) {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) return "symlink";
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

/**
 * @param {{ sourceRoot: string; destination: string; marker: string; force?: boolean }} input
 */
export async function installManagedLink({ sourceRoot, destination, marker, force = false }) {
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedDestination = path.resolve(destination);
  const kind = await pathKind(resolvedDestination);

  if (kind === "missing") {
    await mkdir(path.dirname(resolvedDestination), { recursive: true });
    await symlink(resolvedSource, resolvedDestination);
    return { action: "created", destination: resolvedDestination, source: resolvedSource, marker };
  }

  if (kind === "symlink") {
    const existing = await readlink(resolvedDestination);
    if (path.resolve(path.dirname(resolvedDestination), existing) === resolvedSource) {
      return { action: "unchanged", destination: resolvedDestination, source: resolvedSource, marker };
    }
    if (!force) {
      throw new Error(`destination exists and is not the expected ${marker} link: ${resolvedDestination}`);
    }
    await rm(resolvedDestination);
    await symlink(resolvedSource, resolvedDestination);
    return { action: "replaced", destination: resolvedDestination, source: resolvedSource, marker };
  }

  throw new Error(`refusing to overwrite non-link destination: ${resolvedDestination}`);
}

/**
 * @param {{ destination: string; expectedSource?: string }} input
 */
export async function uninstallManagedLink({ destination, expectedSource }) {
  const resolvedDestination = path.resolve(destination);
  const kind = await pathKind(resolvedDestination);
  if (kind === "missing") return { action: "absent", destination: resolvedDestination };
  if (kind !== "symlink") {
    throw new Error(`refusing to remove non-link destination: ${resolvedDestination}`);
  }
  const existing = await readlink(resolvedDestination);
  const resolvedExisting = path.resolve(path.dirname(resolvedDestination), existing);
  if (expectedSource && path.resolve(expectedSource) !== resolvedExisting) {
    throw new Error(`destination link does not point at expected source: ${resolvedDestination}`);
  }
  await rm(resolvedDestination);
  return { action: "removed", destination: resolvedDestination, source: resolvedExisting };
}

/**
 * @param {string} layoutRoot
 */
export async function discoverSkillIds(layoutRoot) {
  const skillsDir = path.join(layoutRoot, "skills");
  const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).toSorted();
}
