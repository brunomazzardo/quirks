# Quirks Foundation and Task Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dependency-free Quirks kernel that validates project configuration, reads and mutates canonical JSON tasks, executes custom task-source adapters, synchronizes mutations durably, validates compact provenance, and exposes the provider-neutral task CLI.

**Architecture:** This is plan 1 of the Quirks v1 suite. A discriminated `TaskSourceRequest`/`TaskSourceResponse` contract separates campaign logic from storage. The built-in JSON and external-executable drivers implement that contract; a durable outbox wraps all mutations, while compiled standalone JSON-schema validators keep the shipped runtime free of third-party dependencies.

**Tech Stack:** Node.js 24 LTS (`>=24.18.0`), TypeScript 7.0.2, ESM, pnpm 10.30.3, Node `node:test`, Ajv 8.20.0 plus `ajv-formats` 3.0.1 at build time only, and Oxlint 1.74.0.

## Ordered Plan Suite

This plan establishes the contracts consumed by the remaining plans. Do not collapse those subsystems into this implementation pass:

| Order | Planned document | Starts after |
|---|---|---|
| 1 | `2026-07-21-quirks-foundation-task-sources.md` (this plan) | approved design |
| 2 | `2026-07-21-quirks-campaign-control-plane.md` | Task 11 and foundation review |
| 3 | `2026-07-21-quirks-local-control-ui.md` | Task 11; may be authored alongside plan 2 against frozen kernel contracts |
| 4 | `2026-07-21-quirks-skills-git-integration.md` | approved control-plane and runner interfaces |
| 5 | `2026-07-21-quirks-host-integration-acceptance.md` | approved UI, skills, Git, and runner boundaries |

The canonical `.quirks/tasks.json` inventory tracks both these plan-authoring gates and their implementation tasks so later work cannot disappear between documents.

## Global Constraints

- Runtime code has zero third-party production dependencies; Ajv emits standalone validators during the build.
- Version one implements only the built-in JSON driver and the external-executable escape hatch; GitHub, Linear, Jira, and ClickUp remain future adapters.
- Unknown schema fields, unsupported versions, malformed frames, secrets in protocol output, stale revisions, and oversized payloads fail closed.
- The selected task source owns canonical status. Quirks journals mutation intent first and never reports completion before required source acknowledgement.
- JSON coordination is local to one clone and must never be described as a shared or cross-machine lease.
- Project configuration contains no credentials. Credential aliases resolve only from user configuration and never reach task JSON, prompts, or worker environments.
- Task provenance stores references and concise outcomes only—never specifications, plans, patches, logs, prompts, transcripts, model reasoning, provider payloads, or secret output.
- Commands are argv arrays. Do not invoke a shell to execute custom adapters.
- All paths persisted in project data are repository-relative POSIX paths; reject absolute paths, `..` traversal, NUL bytes, and paths outside the canonical repository.
- Every task follows red → green → refactor and ends with a focused commit. Run `pnpm check` before the final plan boundary.

---

### Task 1: Package and toolchain contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `.oxlintrc.json`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `scripts/run-tests.mjs`
- Create: `test/tooling/package-contract.test.mjs`

**Interfaces:**
- Consumes: Node.js `>=24.18.0` and pnpm `10.30.3`.
- Produces: ESM package `@quirks/cli`, `dist/` build output, and the shared `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm check` gates.

- [ ] **Step 1: Write the package-contract test**

```js
// test/tooling/package-contract.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("package pins the approved dependency-free runtime", async () => {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.packageManager, "pnpm@10.30.3");
  assert.equal(pkg.engines.node, ">=24.18.0");
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.equal(pkg.devDependencies.typescript, "7.0.2");
  assert.equal(pkg.devDependencies.ajv, "8.20.0");
  assert.equal(pkg.devDependencies["ajv-formats"], "3.0.1");
  assert.equal(pkg.devDependencies.oxlint, "1.74.0");
  assert.equal(pkg.scripts.test, "pnpm build && node scripts/run-tests.mjs");
});
```

- [ ] **Step 2: Run the test and confirm the package is absent**

Run: `node --test test/tooling/package-contract.test.mjs`

Expected: FAIL with `ENOENT` for `package.json`.

- [ ] **Step 3: Add the package, TypeScript, lint, and ignore configuration**

```json
{
  "name": "@quirks/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.18.0" },
  "packageManager": "pnpm@10.30.3",
  "bin": {
    "quirks-campaign": "dist/src/cli/quirks-campaign.js",
    "quirks-tasks": "dist/src/cli/quirks-tasks.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "lint": "oxlint src test scripts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "pnpm build && node scripts/run-tests.mjs",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "24.13.3",
    "ajv": "8.20.0",
    "ajv-formats": "3.0.1",
    "oxlint": "1.74.0",
    "typescript": "7.0.2"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "allowJs": true,
    "checkJs": false,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.mts", "src/**/*.mjs", "test/**/*.ts", "test/**/*.mjs"]
}
```

```json
// tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "declaration": true,
    "sourceMap": false
  },
  "exclude": ["node_modules", "dist"]
}
```

```json
// .oxlintrc.json
{
  "categories": { "correctness": "error", "suspicious": "error" },
  "ignorePatterns": ["dist/**", "src/schema/generated/**"]
}
```

```gitignore
node_modules/
dist/
coverage/
.superpowers/
*.log
```

```ts
// src/index.ts
export const QUIRKS_PROTOCOL_VERSION = 1 as const;
```

```js
// scripts/run-tests.mjs
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function collectTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(absolute));
    if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(absolute);
  }
  return files;
}

const files = (await collectTests(path.resolve("dist/test"))).sort();
if (files.length === 0) throw new Error("No compiled tests found under dist/test");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
```

- [ ] **Step 4: Install and run the initial gates**

Run: `pnpm install`

Expected: lockfile created with the exact dev dependency versions.

Run: `node --test test/tooling/package-contract.test.mjs`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS with zero warnings.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the toolchain**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json .oxlintrc.json .gitignore src/index.ts scripts/run-tests.mjs test/tooling/package-contract.test.mjs
git commit -m "build: scaffold dependency-free quirks kernel"
```

### Task 2: Canonical JSON, hashes, paths, and typed errors

**Files:**
- Create: `src/core/errors.ts`
- Create: `src/core/canonical-json.ts`
- Create: `src/core/hash.ts`
- Create: `src/core/repository-path.ts`
- Create: `test/core/canonical-json.test.ts`
- Create: `test/core/repository-path.test.ts`

**Interfaces:**
- Consumes: Node `crypto` and `path` only.
- Produces: `canonicalJson(value): string`, `sha256(value): string`, `assertRepositoryRelativePath(value): string`, and `QuirksError` with finite error codes.

- [ ] **Step 1: Write failing canonicalization and path tests**

```ts
// test/core/canonical-json.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  const value = { z: [{ b: 2, a: 1 }], a: true };
  assert.equal(canonicalJson(value), '{"a":true,"z":[{"a":1,"b":2}]}');
  assert.equal(sha256(value), "sha256:4f1cc1676b4591a84b76768886f93f659ac89c3c0ff933f4a0dccb6b2ceda86b");
});

test("canonical JSON rejects undefined and non-JSON numbers", () => {
  assert.throws(() => canonicalJson({ value: undefined }), { name: "QuirksError" });
  assert.throws(() => canonicalJson(Number.NaN), { name: "QuirksError" });
});
```

```ts
// test/core/repository-path.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { assertRepositoryRelativePath } from "../../src/core/repository-path.js";

test("accepts normalized repository-relative POSIX paths", () => {
  assert.equal(assertRepositoryRelativePath("docs/spec.md"), "docs/spec.md");
});

for (const value of ["/tmp/spec.md", "../spec.md", "docs/../secret", "a\\b", "a\0b", ""] as const) {
  test(`rejects unsafe path ${JSON.stringify(value)}`, () => {
    assert.throws(() => assertRepositoryRelativePath(value), { name: "QuirksError" });
  });
}
```

- [ ] **Step 2: Build and verify the imports fail**

Run: `pnpm build`

Expected: FAIL with missing `src/core/*` modules.

- [ ] **Step 3: Implement canonical primitives**

```ts
// src/core/errors.ts
export type QuirksErrorCode =
  | "INVALID_JSON_VALUE"
  | "INVALID_REPOSITORY_PATH"
  | "SCHEMA_INVALID"
  | "UNSUPPORTED_VERSION"
  | "STALE_REVISION"
  | "SOURCE_CONFLICT"
  | "SOURCE_UNAVAILABLE"
  | "PROTOCOL_VIOLATION"
  | "SECRET_REJECTED";

export class QuirksError extends Error {
  override readonly name = "QuirksError";

  constructor(
    readonly code: QuirksErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}
```

```ts
// src/core/canonical-json.ts
import { QuirksError } from "./errors.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normalize(value: unknown, path: string): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${path}[${index}]`));
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, Json> = {};
    for (const key of Object.keys(input).sort()) output[key] = normalize(input[key], `${path}.${key}`);
    return output;
  }
  throw new QuirksError("INVALID_JSON_VALUE", `Non-JSON value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$"));
}
```

```ts
// src/core/hash.ts
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
```

```ts
// src/core/repository-path.ts
import path from "node:path";
import { QuirksError } from "./errors.js";

export function assertRepositoryRelativePath(value: string): string {
  const normalized = path.posix.normalize(value);
  if (
    value.length === 0 || value.includes("\0") || value.includes("\\") ||
    path.posix.isAbsolute(value) || normalized !== value ||
    normalized === ".." || normalized.startsWith("../")
  ) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `Unsafe repository path: ${JSON.stringify(value)}`);
  }
  return normalized;
}
```

- [ ] **Step 4: Build and run the focused tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/core/canonical-json.test.js dist/test/core/repository-path.test.js`

Expected: PASS for every canonicalization, fixed hash, and unsafe-path case.

- [ ] **Step 5: Commit canonical primitives**

```bash
git add src/core test/core
git commit -m "feat: add canonical values and repository paths"
```

### Task 3: Versioned schemas and standalone validators

**Files:**
- Create: `schemas/project-config-v1.schema.json`
- Create: `schemas/json-task-file-v1.schema.json`
- Create: `schemas/normalized-task-v1.schema.json`
- Create: `schemas/task-provenance-v1.schema.json`
- Create: `schemas/task-source-capabilities-v1.schema.json`
- Create: `schemas/task-source-request-v1.schema.json`
- Create: `schemas/task-source-response-v1.schema.json`
- Create: `schemas/task-sync-intent-v1.schema.json`
- Create: `scripts/generate-validators.mjs`
- Create: `src/schema/validate.ts`
- Create: `test/schema/schema-contract.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: schema IDs `quirks://schemas/<name>-v1` and Ajv only during generation.
- Produces: `validateSchema<T>(name, value): T`, generated ESM validators, strict unknown-field rejection, and a single schema-name union used by later tasks.

- [ ] **Step 1: Write the failing schema-contract test**

```ts
// test/schema/schema-contract.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";

const validFile = {
  schemaVersion: 1,
  tasks: [{
    id: "QK-1",
    title: "Test task",
    kind: "implementation",
    priority: "P1",
    status: "ready",
    dependsOn: [],
    workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: [],
      humanGates: [],
      completionBoundary: "accepted-commit"
    },
    sourceRefs: [],
    deliverables: [],
    acceptanceCriteria: ["Focused test passes"],
    verification: ["pnpm test"],
    provenance: { schemaVersion: 1, iterations: [] }
  }]
};

test("accepts the v1 JSON task file and rejects unknown fields", () => {
  assert.equal(validateSchema("json-task-file-v1", validFile), validFile);
  assert.throws(
    () => validateSchema("json-task-file-v1", { ...validFile, surprise: true }),
    /must NOT have additional properties/,
  );
});

test("rejects unsupported schema versions", () => {
  assert.throws(
    () => validateSchema("json-task-file-v1", { ...validFile, schemaVersion: 2 }),
    /schemaVersion/,
  );
});
```

- [ ] **Step 2: Build and verify validation is missing**

Run: `pnpm build`

Expected: FAIL with missing `src/schema/validate.ts`.

- [ ] **Step 3: Add strict draft-2020-12 schemas and validator generation**

Write every schema with `$schema: "https://json-schema.org/draft/2020-12/schema"`, a stable `$id`, `type`, explicit `required`, and `additionalProperties: false` at every object boundary. Use only these finite enums:

```json
{
  "taskKind": ["design", "plan", "implementation", "review", "verification", "documentation", "operations"],
  "priority": ["P0", "P1", "P2", "P3"],
  "taskStatus": ["proposed", "ready", "claimed", "in_review", "blocked", "completed", "cancelled"],
  "phase": ["brainstorm", "plan", "execute", "review", "verification"],
  "effort": ["mechanical", "standard", "high", "principal"],
  "completionBoundary": ["accepted-commit", "campaign-merge", "target-merge", "remote-push"],
  "risk": ["architecture", "security", "identity", "concurrency", "protocol", "git-history", "external-side-effect", "production", "destructive-migration", "cost"],
  "capability": ["repository-read", "repository-write", "network", "remote-git", "external-system", "production", "destructive"],
  "concurrencyStrength": ["atomic", "optimistic", "local-only", "none"],
  "provenanceWriteMode": ["structured", "append-only", "none"]
}
```

The schemas must encode the exact fields from design sections 7, 8, and 8.1. Use this composition table; no schema may accept an undeclared field:

| Schema | Required payload and references |
|---|---|
| `project-config-v1` | `schemaVersion`, constant `protocol`, one discriminated `taskSource` (`json.path` or `external.command` plus optional `credentialAlias`), and `workflowPolicy.skills` |
| `json-task-file-v1` | `schemaVersion` and unique `tasks`; each native task requires every normalized field except derived `source` and `nativeRevision`, and may contain only the lifecycle fields below |
| `normalized-task-v1` | every native task field plus required `source.{driver,nativeId,webUrl}` and `nativeRevision` |
| `task-provenance-v1` | `schemaVersion` and bounded append-only `iterations` with only the compact references and evidence kinds listed in design section 8.1 |
| `task-source-capabilities-v1` | driver/protocol identity, supported operations, concurrency/provenance modes, authority classes, completion boundaries, idempotency lookup support, and byte limits |
| `task-source-request-v1` | the operation-discriminated request union defined in Task 6; all mutations require task ID, expected revision, idempotency key, and their exact operation input |
| `task-source-response-v1` | matching operation plus either `{ ok: true, nativeRevision?, data }` or `{ ok: false, error }`; success and failure fields are mutually exclusive |
| `task-sync-intent-v1` | immutable intent identity/request fields and one finite outbox state with optional validated acknowledgement |

`json-task-file-v1` stores native task fields but forbids derived `source` and `nativeRevision`; `normalized-task-v1` requires both derived fields. Native tasks additionally permit only these lifecycle records: `coordination` is null or `{ scope: "local-clone", campaignId, owner, claimedAt }`, and `statusDetail` is null or `{ reason, unblockCondition }`. All strings have explicit maximum lengths, all arrays have `maxItems`, task IDs match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, and protocol bodies cap at 1 MiB before parsing.

```js
// scripts/generate-validators.mjs
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url);
const schemaDir = new URL("schemas/", root);
const outputDir = new URL("src/schema/generated/", root);
const files = (await readdir(schemaDir)).filter((name) => name.endsWith(".schema.json")).sort();
const ajv = new Ajv2020({ allErrors: true, strict: true, code: { esm: true, source: true } });
addFormats(ajv);
const exports = {};
for (const file of files) {
  const schema = JSON.parse(await readFile(new URL(file, schemaDir), "utf8"));
  const name = path.basename(file, ".schema.json").replaceAll("-", "_");
  ajv.addSchema(schema);
  exports[name] = schema.$id;
}
await mkdir(outputDir, { recursive: true });
await writeFile(new URL("validators.mjs", outputDir), standaloneCode(ajv, exports));
```

```ts
// src/schema/validate.ts
import * as validators from "./generated/validators.mjs";
import { QuirksError } from "../core/errors.js";

export type SchemaName =
  | "project-config-v1"
  | "json-task-file-v1"
  | "normalized-task-v1"
  | "task-provenance-v1"
  | "task-source-capabilities-v1"
  | "task-source-request-v1"
  | "task-source-response-v1"
  | "task-sync-intent-v1";

type Validator = ((value: unknown) => boolean) & { errors?: readonly { instancePath?: string; message?: string }[] | null };

export function validateSchema<T>(name: SchemaName, value: unknown): T {
  const key = name.replaceAll("-", "_") as keyof typeof validators;
  const validate = validators[key] as Validator | undefined;
  if (!validate || !validate(value)) {
    const message = validate?.errors?.map((error) => `${error.instancePath || "/"} ${error.message || "invalid"}`).join("; ") ?? `Unknown schema ${name}`;
    throw new QuirksError("SCHEMA_INVALID", message);
  }
  return value as T;
}
```

Modify `package.json` so `build` is `node scripts/generate-validators.mjs && tsc -p tsconfig.build.json`, and include generated `.mjs` files in `tsconfig.json`.

- [ ] **Step 4: Generate, build, and run schema tests**

Run: `pnpm build`

Expected: PASS and create `src/schema/generated/validators.mjs` plus compiled validators under `dist/`.

Run: `node --test dist/test/schema/schema-contract.test.js`

Expected: PASS for valid, unknown-field, and unsupported-version cases.

- [ ] **Step 5: Commit schemas and generated-validator plumbing**

```bash
git add package.json pnpm-lock.yaml tsconfig.json schemas scripts/generate-validators.mjs src/schema test/schema
git commit -m "feat: add strict versioned protocol schemas"
```

### Task 4: Repository identity, project configuration, and application paths

**Files:**
- Create: `src/project/types.ts`
- Create: `src/project/repository.ts`
- Create: `src/project/config.ts`
- Create: `src/state/app-paths.ts`
- Create: `test/project/config.test.ts`
- Create: `test/state/app-paths.test.ts`

**Interfaces:**
- Consumes: `validateSchema`, safe repository paths, `git rev-parse`, and platform environment directories.
- Produces: `loadProjectContext(startDir, options): Promise<ProjectContext>` and `resolveAppPaths(repositoryId, campaignId?): AppPaths`.

- [ ] **Step 1: Write failing project-context tests**

```ts
// test/project/config.test.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { loadProjectContext } from "../../src/project/config.js";

const execFileAsync = promisify(execFile);

test("loads committed JSON source configuration from the canonical repository", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-project-"));
  await execFileAsync("git", ["init", root]);
  await mkdir(path.join(root, ".agents"));
  await writeFile(path.join(root, ".agents/quirks.json"), JSON.stringify({
    schemaVersion: 1,
    protocol: "quirks-project-v1",
    taskSource: { driver: "json", path: ".quirks/tasks.json" },
    workflowPolicy: { skills: {} }
  }));
  const context = await loadProjectContext(root, { mode: "inspection" });
  assert.equal(context.root, root);
  assert.equal(context.config.taskSource.driver, "json");
  assert.match(context.repositoryId, /^sha256:[a-f0-9]{64}$/);
});
```

- [ ] **Step 2: Build and verify project loading is missing**

Run: `pnpm build`

Expected: FAIL with missing project modules.

- [ ] **Step 3: Implement project discovery and platform state paths**

```ts
// src/project/types.ts
export type TaskSourceConfig =
  | { driver: "json"; path: string }
  | { driver: "external"; command: readonly [string, ...string[]]; credentialAlias?: string };

export interface ProjectConfig {
  schemaVersion: 1;
  protocol: "quirks-project-v1";
  taskSource: TaskSourceConfig;
  workflowPolicy: { skills: Readonly<Record<string, string>> };
}

export interface ProjectContext {
  root: string;
  repositoryId: string;
  configPath: string;
  configTracked: boolean;
  config: ProjectConfig;
  configHash: string;
}
```

```ts
// src/project/repository.ts
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { sha256 } from "../core/hash.js";

const execFileAsync = promisify(execFile);

export async function canonicalRepository(startDir: string): Promise<{ root: string; repositoryId: string }> {
  const { stdout } = await execFileAsync("git", ["-C", startDir, "rev-parse", "--show-toplevel"]);
  const root = await realpath(stdout.trim());
  return { root, repositoryId: sha256({ root }) };
}
```

```ts
// src/state/app-paths.ts
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  root: string;
  repository: string;
  campaigns: string;
  campaign?: string;
}

export function resolveAppPaths(repositoryId: string, campaignId?: string): AppPaths {
  const base = process.env.QUIRKS_STATE_DIR ?? (
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Quirks")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support", "Quirks")
        : path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "quirks")
  );
  const repository = path.join(base, "repositories", repositoryId.replace(":", "-"));
  const campaigns = path.join(repository, "campaigns");
  return { root: base, repository, campaigns, ...(campaignId ? { campaign: path.join(campaigns, campaignId) } : {}) };
}
```

`loadProjectContext(startDir, { mode, configPath? })` must call `canonicalRepository`, read exactly `.agents/quirks.json` unless an explicit repository-relative config path was passed, reject symlinks escaping the repository, validate the config, normalize only repository-relative source paths, and hash the validated configuration. It determines `configTracked` with `git ls-files --error-unmatch`. `mode: "inspection"` may return an untracked config with `configTracked: false`; `mode: "unattended"` rejects it.

- [ ] **Step 4: Build and run project/path tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/project/config.test.js dist/test/state/app-paths.test.js`

Expected: PASS, including explicit `QUIRKS_STATE_DIR` isolation and unsafe-config-path rejection.

- [ ] **Step 5: Commit project discovery**

```bash
git add src/project src/state/app-paths.ts test/project test/state
git commit -m "feat: load canonical quirks project configuration"
```

### Task 5: Atomic files, event journal, and local repository lock

**Files:**
- Create: `src/state/atomic-file.ts`
- Create: `src/state/event-journal.ts`
- Create: `src/state/repository-lock.ts`
- Create: `src/state/types.ts`
- Create: `test/state/atomic-file.test.ts`
- Create: `test/state/event-journal.test.ts`
- Create: `test/state/repository-lock.test.ts`

**Interfaces:**
- Consumes: `AppPaths` and canonical JSON.
- Produces: `writeJsonAtomic`, `EventJournal.append/read`, and `RepositoryLock.acquire/release` with local-only ownership metadata.

- [ ] **Step 1: Write failing durability tests**

```ts
// test/state/event-journal.test.ts
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventJournal } from "../../src/state/event-journal.js";

test("journal appends framed events and rejects a torn final frame", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-journal-"));
  const journal = new EventJournal(path.join(dir, "events.jsonl"));
  await journal.append({ schemaVersion: 1, id: "evt-1", type: "created", at: "2026-07-21T00:00:00.000Z", data: {} });
  assert.deepEqual(await journal.read(), [{ schemaVersion: 1, id: "evt-1", type: "created", at: "2026-07-21T00:00:00.000Z", data: {} }]);
});
```

```ts
// test/state/repository-lock.test.ts
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RepositoryLock } from "../../src/state/repository-lock.js";

test("permits one local writer and never calls the lock global", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-lock-"));
  const first = await RepositoryLock.acquire(path.join(dir, "lock"), { campaignId: "C-1" });
  await assert.rejects(() => RepositoryLock.acquire(path.join(dir, "lock"), { campaignId: "C-2" }), /LOCAL_LOCK_HELD/);
  assert.equal(first.scope, "local-clone");
  await first.release();
});
```

- [ ] **Step 2: Build and verify state primitives are missing**

Run: `pnpm build`

Expected: FAIL with missing state modules.

- [ ] **Step 3: Implement durable state primitives**

`writeJsonAtomic(path, value)` must create the parent directory, open a same-directory temporary file with mode `0o600`, write canonical JSON plus one newline, `fsync` the file, close it, rename it over the destination, and `fsync` the parent directory on POSIX. Cleanup may remove only the exact temporary path created by the function.

`EventJournal.append` must serialize each event as canonical single-line JSON, reject newline-containing strings only when they violate the event schema, append with `O_APPEND`, and `fsync` before returning. `read` must parse every non-empty line and fail with `PROTOCOL_VIOLATION` on a torn or malformed frame; it must not silently discard history.

`RepositoryLock.acquire` must use exclusive file creation, persist `{ schemaVersion: 1, scope: "local-clone", campaignId, pid, hostname, acquiredAt, heartbeatAt }`, and expose `heartbeat()` plus `release()`. A stale lock is not removed automatically in this task; return its typed metadata so the later campaign recovery plan can prove process/session/Git state before takeover.

- [ ] **Step 4: Run durability and contention tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/state`

Expected: PASS for atomic replacement, torn-frame rejection, one-writer contention, exact release, and `local-clone` labeling.

- [ ] **Step 5: Commit durable state primitives**

```bash
git add src/state test/state
git commit -m "feat: add durable local state primitives"
```

### Task 6: Provider-neutral TaskSource protocol and conformance harness

**Files:**
- Create: `src/task-source/types.ts`
- Create: `src/task-source/task-source.ts`
- Create: `src/task-source/factory.ts`
- Create: `test/task-source/contract.ts`
- Create: `test/task-source/fake-source.ts`
- Create: `test/task-source/protocol.test.ts`

**Interfaces:**
- Consumes: validated project configuration and v1 schemas.
- Produces: `TaskSource.execute(request): Promise<TaskSourceResponse>`, discriminated request/response unions, `createTaskSource`, and a reusable driver conformance suite.

- [ ] **Step 1: Write the failing protocol test**

```ts
// test/task-source/protocol.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { assertTaskSourceContract } from "./contract.js";
import { FakeTaskSource } from "./fake-source.js";

test("fake source satisfies the provider-neutral contract", async () => {
  await assertTaskSourceContract(() => new FakeTaskSource());
});

test("mutation identity is campaign/task/operation/event scoped", async () => {
  const source = new FakeTaskSource();
  const response = await source.execute({
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: "sha256:one",
    idempotencyKey: "C-1:QK-1:claim:evt-1",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" }
  });
  assert.equal(response.operation, "claim");
});
```

- [ ] **Step 2: Build and verify protocol types are missing**

Run: `pnpm build`

Expected: FAIL with missing `src/task-source/*`.

- [ ] **Step 3: Define the exact semantic protocol**

```ts
// src/task-source/types.ts
export type TaskSourceOperation =
  | "capabilities" | "validate" | "list" | "show" | "claim"
  | "submit-review" | "attach-provenance" | "complete" | "block"
  | "release" | "propose" | "verify";

export type ReadOperation = "capabilities" | "validate" | "list" | "show" | "verify";
export type MutationOperation = Exclude<TaskSourceOperation, ReadOperation>;

type EmptyInput = Readonly<Record<string, never>>;

interface InputByOperation {
  capabilities: EmptyInput;
  validate: EmptyInput;
  list: { status?: string };
  show: EmptyInput;
  verify: { scope: "campaign" | "task" };
  claim: { campaignId: string; owner: string; claimedAt: string };
  "submit-review": { evidenceRefs: readonly string[] };
  "attach-provenance": { iteration: unknown };
  complete: { evidenceRefs: readonly string[] };
  block: { reason: string; unblockCondition: string };
  release: { campaignId: string };
  propose: { task: unknown };
}

interface RequestBase<O extends TaskSourceOperation> {
  schemaVersion: 1;
  operation: O;
  input: Readonly<InputByOperation[O]>;
}

type SourceWideReadRequest = {
  [O in "capabilities" | "validate" | "list"]: RequestBase<O>
}["capabilities" | "validate" | "list"];

type TaskReadRequest = RequestBase<"show"> & { taskId: string };
type VerifyRequest = RequestBase<"verify"> & { taskId?: string };

export type MutationRequest = {
  [O in MutationOperation]: RequestBase<O> & {
    taskId: string;
    expectedNativeRevision: string;
    idempotencyKey: string;
  }
}[MutationOperation];

export type TaskSourceRequest = SourceWideReadRequest | TaskReadRequest | VerifyRequest | MutationRequest;

interface ResponseBase<O extends TaskSourceOperation> {
  schemaVersion: 1;
  operation: O;
}

type SuccessResponse<O extends TaskSourceOperation> = ResponseBase<O> & {
  ok: true;
  nativeRevision?: string;
  data: unknown;
};

type FailureResponse<O extends TaskSourceOperation> = ResponseBase<O> & {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
};

export type TaskSourceResponse = {
  [O in TaskSourceOperation]: SuccessResponse<O> | FailureResponse<O>
}[TaskSourceOperation];

export interface TaskSourceCapabilities {
  schemaVersion: 1;
  protocol: "task-source-v1";
  driver: string;
  concurrencyStrength: "atomic" | "optimistic" | "local-only" | "none";
  provenanceWriteMode: "structured" | "append-only" | "none";
  commentWriteMode: "structured" | "append-only" | "none";
  idempotencyLookup: "none" | "state" | "key";
  operations: readonly TaskSourceOperation[];
  authorityClasses: readonly ("repository" | "network" | "remote-git" | "external-system" | "production")[];
  completionBoundaries: readonly ("accepted-commit" | "campaign-merge" | "target-merge" | "remote-push")[];
  maxRequestBytes: number;
  maxResponseBytes: number;
}
```

```ts
// src/task-source/task-source.ts
import type { TaskSourceRequest, TaskSourceResponse } from "./types.js";

export interface TaskSource {
  execute(request: TaskSourceRequest): Promise<TaskSourceResponse>;
}

export function assertMutationIdentity(request: TaskSourceRequest): void {
  if (!("idempotencyKey" in request)) return;
  if (!request.taskId || !request.expectedNativeRevision || !request.idempotencyKey) {
    throw new TypeError(`Mutation ${request.operation} has an empty identity field`);
  }
}
```

The conformance entry point is `assertTaskSourceContract(create: () => TaskSource | Promise<TaskSource>): Promise<void>`. It must test capabilities, list/show agreement, stable revisions, unknown task failure, stale mutation rejection, idempotent replay, conflicting idempotency reuse, unsupported operations, 1 MiB request/response bounds, unknown-field rejection, and secret-shaped response rejection. `createTaskSource` supports only `json` and `external`; any other driver fails with `UNSUPPORTED_VERSION` rather than dynamically importing a name.

- [ ] **Step 4: Run the protocol contract tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/task-source/protocol.test.js`

Expected: PASS for the fake source and all negative protocol cases.

- [ ] **Step 5: Commit the TaskSource boundary**

```bash
git add src/task-source test/task-source
git commit -m "feat: define provider-neutral task source contract"
```

### Task 7: Built-in JSON task-source driver

**Files:**
- Create: `src/task-source/json/json-task-source.ts`
- Create: `src/task-source/json/json-mutations.ts`
- Create: `src/task-source/json/json-revision.ts`
- Create: `test/task-source/json/json-task-source.test.ts`
- Create: `test/fixtures/json-project/.agents/quirks.json`
- Create: `test/fixtures/json-project/.quirks/tasks.json`
- Modify: `src/task-source/factory.ts`

**Interfaces:**
- Consumes: `TaskSource`, strict schemas, canonical hashes, atomic files, and local repository paths.
- Produces: `JsonTaskSource` with `local-only` concurrency, structured provenance, deterministic per-task revisions, and all semantic mutations.

- [ ] **Step 1: Write failing JSON-driver contract and stale-write tests**

```ts
// test/task-source/json/json-task-source.test.ts
import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonTaskSource } from "../../../src/task-source/json/json-task-source.js";
import { assertTaskSourceContract } from "../contract.js";

const sourceFixture = path.resolve("test/fixtures/json-project");

async function freshFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-json-source-"));
  await cp(sourceFixture, root, { recursive: true });
  return root;
}

test("JSON driver satisfies the shared contract", async () => {
  await assertTaskSourceContract(async () => JsonTaskSource.open(await freshFixture()));
});

test("JSON driver rejects a stale claim without changing the file", async () => {
  const source = await JsonTaskSource.open(await freshFixture());
  const shown = await source.execute({ schemaVersion: 1, operation: "show", taskId: "QK-1", input: {} });
  if (!shown.ok) assert.fail(shown.error.message);
  const response = await source.execute({
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: `${shown.nativeRevision}-stale`,
    idempotencyKey: "C-1:QK-1:claim:evt-stale",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" }
  });
  if (response.ok) assert.fail("stale mutation succeeded");
  assert.equal(response.error.code, "STALE_REVISION");
});
```

- [ ] **Step 2: Build and verify the JSON driver is missing**

Run: `pnpm build`

Expected: FAIL with missing JSON driver modules.

- [ ] **Step 3: Implement JSON reads, mutations, and atomic persistence**

`JsonTaskSource.open` resolves the configured task path inside the canonical repository and refuses symlink escape. Every operation reloads and validates the complete file. `show` derives:

```ts
const normalized = {
  ...nativeTask,
  source: { driver: "json", nativeId: nativeTask.id, webUrl: null },
  nativeRevision: sha256(nativeTask),
};
```

Mutations acquire `AppPaths.repository/task-sources/json.lock`, reload, compare `sha256(nativeTask)` with `expectedNativeRevision`, reject reused idempotency keys with different request hashes, apply exactly one semantic change, validate the new envelope, and persist through `writeJsonAtomic`. Store idempotency acknowledgements in the bounded app-state journal `AppPaths.repository/task-sources/json-events.jsonl`, not in the target repository or task prose.

Use these state effects:

- `claim`: status `ready → claimed` and `coordination = { scope: "local-clone", campaignId, owner, claimedAt }`.
- `release`: clear coordination and return an unlanded claim to `ready`.
- `block`: set status `blocked` and `statusDetail = { reason, unblockCondition }`.
- `submit-review`: set status `in_review`; evidence remains compact references.
- `attach-provenance`: append one validated iteration or merge an idempotent acknowledgement for the same iteration ID.
- `complete`: require the configured completion-boundary evidence, set `completed`, and clear coordination.
- `propose`: add a new schema-valid task only when its ID does not exist.
- `verify`: return declared commands as data; never execute them in the driver.

- [ ] **Step 4: Run JSON contract, mutation, and interruption tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/task-source/json`

Expected: PASS for all operations, stale revisions, replay, local-only claims, atomic replacement, schema rollback, and symlink escape.

- [ ] **Step 5: Commit the JSON driver**

```bash
git add src/task-source/json src/task-source/factory.ts test/task-source/json test/fixtures/json-project
git commit -m "feat: add canonical JSON task source"
```

### Task 8: External-executable task-source driver

**Files:**
- Create: `src/task-source/external/external-task-source.ts`
- Create: `src/task-source/external/framing.ts`
- Create: `src/task-source/external/environment.ts`
- Create: `test/task-source/external/external-task-source.test.ts`
- Create: `test/fixtures/external-adapter/fake-adapter.mjs`
- Modify: `src/task-source/factory.ts`

**Interfaces:**
- Consumes: external argv configuration and the same protocol schemas.
- Produces: `ExternalTaskSource`, bounded one-request/one-response JSON framing, scrubbed environment, timeout/cancel behavior, and protocol-only stdout.

- [ ] **Step 1: Write failing framing and environment tests**

```ts
// test/task-source/external/external-task-source.test.ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { ExternalTaskSource } from "../../../src/task-source/external/external-task-source.js";

test("passes one JSON request without invoking a shell", async () => {
  const source = new ExternalTaskSource({
    command: [process.execPath, path.resolve("test/fixtures/external-adapter/fake-adapter.mjs")],
    timeoutMs: 2_000,
    maxOutputBytes: 1_048_576,
    environment: { QUIRKS_TEST_MODE: "1" }
  });
  const response = await source.execute({ schemaVersion: 1, operation: "capabilities", input: {} });
  assert.equal(response.ok, true);
  assert.equal(response.operation, "capabilities");
});

test("rejects extra stdout after the response frame", async () => {
  const source = new ExternalTaskSource({
    command: [process.execPath, path.resolve("test/fixtures/external-adapter/fake-adapter.mjs")],
    timeoutMs: 2_000,
    maxOutputBytes: 1_048_576,
    environment: { QUIRKS_FIXTURE_MODE: "extra-stdout" }
  });
  await assert.rejects(() => source.execute({ schemaVersion: 1, operation: "list", input: {} }), /PROTOCOL_VIOLATION/);
});
```

- [ ] **Step 2: Build and verify the external driver is missing**

Run: `pnpm build`

Expected: FAIL with missing external driver modules.

- [ ] **Step 3: Implement bounded spawn-without-shell framing**

`ExternalTaskSource` must call `spawn(command[0], command.slice(1), { shell: false, cwd: repositoryRoot, env: scrubbedEnv, stdio: ["pipe", "pipe", "pipe"] })`. `scrubbedEnv` starts empty and adds only `PATH`, platform-required process variables, explicit non-secret adapter variables, and the resolved credential-variable allow-list. `HOME`/`USERPROFILE` points to a fresh mode-`0700` adapter sandbox that contains only explicitly projected provider files; it never points to the operator's real home. It must never inherit `NODE_OPTIONS`, arbitrary `QUIRKS_*`, CI secrets, SSH material, browser state, provider-wide config directories, or runner credentials.

Write exactly one canonical request line, close stdin, collect stdout and stderr independently with byte limits, enforce a monotonic timeout, send a scoped termination to only that child, require exit code zero plus exactly one non-empty stdout JSON line, validate the response schema and matching operation, reject secret-shaped response values, and include only bounded redacted stderr in typed diagnostic details.

The fake adapter must implement `capabilities`, `validate`, `list`, `show`, and deterministic failure modes selected by `QUIRKS_FIXTURE_MODE`: `extra-stdout`, `oversized`, `timeout`, `malformed`, `secret`, `exit-zero-error`, and `stale`.

- [ ] **Step 4: Run external-driver contract and abuse tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/task-source/external`

Expected: PASS for valid framing and every malformed, oversized, secret, timeout, stale, and extra-output case.

- [ ] **Step 5: Commit the external driver**

```bash
git add src/task-source/external src/task-source/factory.ts test/task-source/external test/fixtures/external-adapter
git commit -m "feat: add bounded external task source"
```

### Task 9: Durable sync outbox and reconciliation service

**Files:**
- Create: `src/sync/types.ts`
- Create: `src/sync/outbox.ts`
- Create: `src/sync/reconciler.ts`
- Create: `src/sync/boundaries.ts`
- Create: `test/sync/outbox.test.ts`
- Create: `test/sync/reconciler.test.ts`
- Create: `test/sync/support/memory-outbox.ts`
- Create: `test/sync/support/ambiguous-source.ts`

**Interfaces:**
- Consumes: `TaskSource`, event journal, atomic files, expected revisions, and idempotency keys.
- Produces: `SyncOutbox.enqueue/acknowledge/conflict/pending`, `reconcilePending`, and `syncBoundary` for preflight/claim/resume/review/completion/landing/final-report.

- [ ] **Step 1: Write failing outbox ordering and ambiguous-ack tests**

```ts
// test/sync/reconciler.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { reconcileMutation } from "../../src/sync/reconciler.js";
import { MemoryOutbox } from "./support/memory-outbox.js";
import { AmbiguousThenAcknowledgedSource } from "./support/ambiguous-source.js";

test("persists intent before source call and resolves ambiguity by fresh source state", async () => {
  const outbox = new MemoryOutbox();
  const source = new AmbiguousThenAcknowledgedSource();
  const result = await reconcileMutation({ campaignId: "C-1", outbox, source, request: source.claimRequest });
  assert.deepEqual(outbox.transitions, ["pending", "acknowledged"]);
  assert.equal(result.state, "acknowledged");
  assert.equal(source.mutationCalls, 1);
});

test("canonical conflict pauses instead of overwriting", async () => {
  const outbox = new MemoryOutbox();
  const source = new AmbiguousThenAcknowledgedSource({ conflict: true });
  const result = await reconcileMutation({ campaignId: "C-1", outbox, source, request: source.claimRequest });
  assert.equal(result.state, "conflict");
  assert.equal(source.mutationCalls, 1);
});
```

```ts
// test/sync/support/memory-outbox.ts
import type { SyncIntent, SyncState } from "../../../src/sync/types.js";

export class MemoryOutbox {
  readonly transitions: SyncState[] = [];
  intent?: SyncIntent;

  async enqueue(intent: SyncIntent): Promise<void> {
    this.intent = intent;
    this.transitions.push("pending");
  }

  async transition(intentId: string, state: SyncState): Promise<void> {
    if (!this.intent || this.intent.intentId !== intentId) throw new Error("missing intent");
    this.intent = { ...this.intent, state, updatedAt: "2026-07-21T00:00:01.000Z" };
    this.transitions.push(state);
  }
}
```

```ts
// test/sync/support/ambiguous-source.ts
import type { TaskSource } from "../../../src/task-source/task-source.js";
import type { MutationRequest, TaskSourceRequest, TaskSourceResponse } from "../../../src/task-source/types.js";

export class AmbiguousThenAcknowledgedSource implements TaskSource {
  mutationCalls = 0;
  readonly claimRequest: MutationRequest = {
    schemaVersion: 1,
    operation: "claim",
    taskId: "QK-1",
    expectedNativeRevision: "sha256:before",
    idempotencyKey: "C-1:QK-1:claim:evt-1",
    input: { campaignId: "C-1", owner: "supervisor:S-1", claimedAt: "2026-07-21T00:00:00.000Z" }
  };

  constructor(private readonly options: { conflict?: boolean } = {}) {}

  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    if (request.operation === "claim") {
      this.mutationCalls += 1;
      if (this.options.conflict) return { schemaVersion: 1, operation: "claim", ok: false, error: { code: "STALE_REVISION", message: "changed", retryable: false } };
      throw Object.assign(new Error("connection lost after write"), { code: "SOURCE_UNAVAILABLE" });
    }
    if (request.operation === "show") {
      return { schemaVersion: 1, operation: "show", ok: true, nativeRevision: "sha256:after", data: { id: "QK-1", status: "claimed", coordination: { campaignId: "C-1" } } };
    }
    return { schemaVersion: 1, operation: request.operation, ok: true, data: {} } as TaskSourceResponse;
  }
}
```

- [ ] **Step 2: Build and verify sync modules are missing**

Run: `pnpm build`

Expected: FAIL with missing sync modules.

- [ ] **Step 3: Implement append-only sync intent and reconciliation**

```ts
// src/sync/types.ts
import type { MutationOperation, MutationRequest, TaskSourceResponse } from "../task-source/types.js";

export type SyncState = "pending" | "acknowledged" | "conflict" | "failed";

export interface SyncIntent {
  schemaVersion: 1;
  intentId: string;
  campaignId: string;
  taskId: string;
  operation: MutationOperation;
  requestHash: string;
  request: MutationRequest;
  state: SyncState;
  createdAt: string;
  updatedAt: string;
  acknowledgement?: TaskSourceResponse;
}

export interface OutboxPort {
  enqueue(intent: SyncIntent): Promise<void>;
  transition(intentId: string, state: SyncState, acknowledgement?: TaskSourceResponse): Promise<void>;
}
```

`SyncOutbox` is an event-sourced JSONL store. `enqueue` fsyncs `pending` before returning the intent. State changes append events and rebuild the current projection by `intentId`; history is never edited. Reusing an idempotency key with a different request hash fails.

`reconcileMutation({ campaignId, outbox, source, request }): Promise<SyncIntent>` accepts an `OutboxPort`, performs exactly one adapter mutation attempt, and returns the latest projected intent. On typed stale/conflict it records `conflict`. On a transport failure it calls `show` and compares current native state plus an adapter-provided idempotency lookup when supported; it records `acknowledged` only with positive evidence, otherwise leaves `pending`. It never blindly repeats a non-idempotent operation.

`syncBoundary` refreshes all selected task revisions before `preflight`, `claim`, `resume`, `review`, `completion`, `landing`, and `final-report`, then reconciles pending intents whose capability metadata proves safe lookup/retry. Required unacknowledged completion or provenance intents prevent a completed result.

- [ ] **Step 4: Run sync ordering, retry, and conflict tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/sync`

Expected: PASS for durable-before-call ordering, acknowledgement, pending outage, ambiguous acceptance, safe idempotent retry, stale conflict, and no premature completion.

- [ ] **Step 5: Commit synchronization**

```bash
git add src/sync test/sync
git commit -m "feat: add durable task synchronization outbox"
```

### Task 10: Compact provenance validation and attribution

**Files:**
- Create: `src/provenance/types.ts`
- Create: `src/provenance/git-evidence.ts`
- Create: `src/provenance/provider-evidence.ts`
- Create: `src/provenance/validate.ts`
- Create: `src/provenance/read-model.ts`
- Create: `test/provenance/validate.test.ts`
- Create: `test/provenance/read-model.test.ts`
- Create: `test/provenance/support/git-fixture.ts`

**Interfaces:**
- Consumes: repository identity, Git objects, safe paths, task-source capabilities, and candidate worker references.
- Produces: `validateProvenanceCandidate`, `buildTaskHistory`, and evidence-labeled operator/agent/Git/provider identities.

- [ ] **Step 1: Write failing historical-reference and identity tests**

```ts
// test/provenance/validate.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { validateProvenanceCandidate } from "../../src/provenance/validate.js";
import { createGitFixture } from "./support/git-fixture.js";

const fixture = await createGitFixture();

test("accepts a file only when it exists at the stated commit", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "spec",
    path: "docs/spec.md",
    commit: fixture.baseCommit
  });
  assert.equal(result.availability, "available");
});

test("does not substitute current content for a missing historical object", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "plan",
    path: "docs/current-only.md",
    commit: fixture.baseCommit
  });
  assert.equal(result.availability, "missing-at-commit");
  assert.equal(result.currentReplacement, undefined);
});

test("Git names are self-asserted without signature evidence", async () => {
  const result = await validateProvenanceCandidate(fixture.root, { kind: "commit", sha: fixture.baseCommit });
  assert.equal(result.committer?.evidence, "self-asserted-git-metadata");
  assert.equal(result.committer?.verified, false);
});
```

```ts
// test/provenance/support/git-fixture.ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createGitFixture(): Promise<{ root: string; baseCommit: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-provenance-"));
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Fixture Author"]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  await mkdir(path.join(root, "docs"));
  await writeFile(path.join(root, "docs/spec.md"), "# Executed spec\n");
  await execFileAsync("git", ["-C", root, "add", "docs/spec.md"]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "docs: add executed spec"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
  await writeFile(path.join(root, "docs/current-only.md"), "# Current only\n");
  return { root, baseCommit: stdout.trim() };
}
```

- [ ] **Step 2: Build and verify provenance modules are missing**

Run: `pnpm build`

Expected: FAIL with missing provenance modules.

- [ ] **Step 3: Implement reference-only provenance validation**

Define `ProvenanceIteration` with campaign/task revisions, envelope digest, outcome, completion boundary, base/accepted/landed SHAs, artifact refs, commit refs, PR refs, verification refs, participants, timing/usage, deviations, follow-ups, and supersession. Every list has a schema maximum and every summary has a byte maximum.

Use `execFile("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`])`, `git show ${sha}:${path}`, `git show --show-signature --format=...`, and `git merge-base --is-ancestor` with argv arrays. Never interpolate a shell command. A missing object returns typed availability; it is not rewritten to `HEAD`.

Remote URLs must parse with `new URL`, use `https:`, have no username/password, and be stored only after the provider adapter validates its repository locator. Operator evidence is one of `configured-profile`, `authenticated-host`, `authenticated-provider`, or `self-asserted`; only a valid Git signature or authenticated provider identity sets `verified: true`.

`buildTaskHistory` joins compact source provenance and validated local campaign events by stable IDs, derives counts, orders iterations append-only, and emits explicit `unavailable` references. It never copies source file bodies, logs, prompts, transcripts, patches, or provider payloads.

- [ ] **Step 4: Run provenance and hostile-reference tests**

Run: `pnpm build`

Expected: PASS.

Run: `node --test dist/test/provenance`

Expected: PASS for available/missing historical paths, traversal, invalid URLs, signed/unsigned identity, distinct authors/committers/operators, partial/superseded iterations, and no content duplication.

- [ ] **Step 5: Commit provenance validation**

```bash
git add src/provenance test/provenance
git commit -m "feat: validate compact task provenance"
```

### Task 11: Task CLI and portable end-to-end fixture

**Files:**
- Create: `src/cli/args.ts`
- Create: `src/cli/output.ts`
- Create: `src/cli/quirks-tasks.ts`
- Create: `src/cli/quirks-campaign.ts`
- Create: `test/cli/quirks-tasks.test.ts`
- Create: `test/integration/task-source-kernel.test.ts`
- Modify: `src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: project context, task-source factory, sync reconciler, and provenance read model.
- Produces: `quirks-tasks validate|list|show|sync --json`, stable exit codes, protocol-only stdout in JSON mode, and a placeholder-free `quirks-campaign` command that explicitly reports later-plan unavailability.

- [ ] **Step 1: Write failing CLI integration tests**

```ts
// test/integration/task-source-kernel.test.ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("JSON fixture validates, lists, shows, and synchronizes through the same CLI", async () => {
  const cli = new URL("../../src/cli/quirks-tasks.js", import.meta.url).pathname;
  const cwd = path.resolve("test/fixtures/json-project");
  const list = JSON.parse((await execFileAsync(process.execPath, [cli, "list", "--json"], { cwd })).stdout);
  assert.equal(list.ok, true);
  assert.equal(list.tasks[0].source.driver, "json");
  const sync = JSON.parse((await execFileAsync(process.execPath, [cli, "sync", "--json"], { cwd })).stdout);
  assert.equal(sync.ok, true);
  assert.equal(sync.pending, 0);
});

test("unknown commands fail without printing help to stdout JSON", async () => {
  const cli = new URL("../../src/cli/quirks-tasks.js", import.meta.url).pathname;
  await assert.rejects(
    () => execFileAsync(process.execPath, [cli, "unknown", "--json"]),
    (error: { code?: number; stdout?: string }) => error.code === 2 && error.stdout === "",
  );
});
```

- [ ] **Step 2: Build and verify CLI modules are missing**

Run: `pnpm build`

Expected: FAIL with missing CLI modules.

- [ ] **Step 3: Implement exact CLI parsing and JSON output**

`args.ts` accepts only:

```text
quirks-tasks validate [--config PATH] [--json]
quirks-tasks list [--config PATH] [--status STATUS] [--json]
quirks-tasks show TASK_ID [--config PATH] [--json]
quirks-tasks sync [--config PATH] [--json]
```

Duplicate flags, combined short flags, unknown options, missing values, and extra positionals exit `2`. Domain validation/conflict exits `3`; unavailable source exits `4`; unexpected internal failure exits `1`. In `--json` mode stdout contains exactly one bounded JSON object and diagnostics go to stderr. Human output states source driver, freshness, pending/conflict count, and `Local coordination only` for the JSON driver.

`quirks-campaign` exits `2` with the exact message `Campaign execution is not installed; implement the approved runner-control and campaign plans.` This is an honest boundary, not a successful stub.

Export public kernel types and factories from `src/index.ts`; do not export generated validators or internal file helpers.

- [ ] **Step 4: Run the complete foundation acceptance suite**

Run: `pnpm check`

Expected: PASS with lint, strict type-check, schema generation, unit tests, JSON/external conformance, sync, provenance, and CLI integration.

Run: `node dist/src/cli/quirks-tasks.js validate --json`

Working directory: `test/fixtures/json-project`

Expected stdout: one JSON object with `"ok":true`, `"driver":"json"`, and zero schema errors.

- [ ] **Step 5: Commit the executable foundation boundary**

```bash
git add src/cli src/index.ts test/cli test/integration package.json pnpm-lock.yaml
git commit -m "feat: expose quirks task source CLI"
```

## Plan Boundary Verification

- [ ] Run `pnpm check` from a clean worktree and record the command plus exit code in the task provenance candidate.
- [ ] Run the shared conformance suite once against the JSON driver and once against the external fake provider.
- [ ] Search shipped files for absolute personal paths, project names from fixture history, credentials, shell command strings, `TODO`, `TBD`, and `FIXME`; the only allowed project names are disposable fixture identifiers.
- [ ] Confirm `git status --short` contains only intentionally tracked changes.
- [ ] Request an independent review of the full foundation diff against design sections 5.4, 7, 8, 8.1, 17, 20, 21, 23.2, and 23.4 before beginning the local-control-UI plan.
