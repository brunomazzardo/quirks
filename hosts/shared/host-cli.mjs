import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string[]} argv
 */
export function parseHostCliArgs(argv) {
  /** @type {{ root?: string; source?: string; json: boolean }} */
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      options.root = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--source") {
      options.source = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument ${token}`);
  }
  return options;
}

/**
 * @param {string} moduleUrl
 */
export function isExecutedDirectly(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(moduleUrl);
}

/**
 * @param {string} moduleUrl
 */
export function defaultSourceRoot(moduleUrl) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "../..");
}

/**
 * @param {unknown} result
 */
export function writeHostCliResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
