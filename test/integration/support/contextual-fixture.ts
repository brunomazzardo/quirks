import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadProjectContext } from "../../../src/project/config.js";
import { createTaskSource } from "../../../src/task-source/factory.js";
import { materializePlannedTasks } from "../../../src/task-authoring/materialize.js";
import type { MaterializedTask, NativeTaskCandidate } from "../../../src/task-authoring/types.js";
import type { ProjectContext } from "../../../src/project/types.js";
import type { TaskSource } from "../../../src/task-source/task-source.js";

const execFileAsync = promisify(execFile);

export const PLAN_PATH = "docs/superpowers/plans/contextual-copy-prompts.md";
export const SPEC_PATH = "docs/superpowers/specs/contextual-copy-prompts-design.md";
export const FEATURE_TASK_ID = "QK-PRM-001";
export const PLAN_TASK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function planMarkdown(): string {
  const sections = PLAN_TASK_NUMBERS.map((task) =>
    [
      `### Task ${task}: Plan task ${task}`,
      "",
      `- [ ] **Step 1: Write the failing test for task ${task}**`,
      `- [ ] **Step 2: Implement task ${task}**`,
      "",
    ].join("\n"),
  );
  return `# Contextual copy prompts plan\n\n${sections.join("\n")}`;
}

export interface ContextualFixture {
  root: string;
  stateDir: string;
  planCommit: string;
  context: ProjectContext;
  source: TaskSource;
  dispose: () => Promise<void>;
}

export async function createContextualFixture(): Promise<ContextualFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-contextual-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-contextual-state-"));
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;

  await mkdir(path.join(root, ".agents"), { recursive: true });
  await mkdir(path.join(root, ".quirks"), { recursive: true });
  await mkdir(path.join(root, path.dirname(PLAN_PATH)), { recursive: true });
  await mkdir(path.join(root, path.dirname(SPEC_PATH)), { recursive: true });
  await writeFile(
    path.join(root, ".agents/quirks.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      protocol: "quirks-project-v1",
      taskSource: { driver: "json", path: ".quirks/tasks.json" },
      workflowPolicy: { skills: { execute: "executing-tasks" } },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(root, ".quirks/tasks.json"), '{"schemaVersion":1,"tasks":[]}\n', "utf8");
  await writeFile(path.join(root, PLAN_PATH), planMarkdown(), "utf8");
  await writeFile(path.join(root, SPEC_PATH), "# Contextual copy prompts design\n", "utf8");

  const git = (...args: string[]) => execFileAsync("git", ["-C", root, ...args]);
  await git("init");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Quirks Test");
  await git("add", ".");
  await git("commit", "-m", "fixture: contextual prompts plan");
  const { stdout } = await git("rev-parse", "HEAD");
  const planCommit = stdout.trim();

  const context = await loadProjectContext(root, { mode: "inspection" });
  const source = await createTaskSource(context);

  return {
    root,
    stateDir,
    planCommit,
    context,
    source,
    dispose: async () => {
      await source.dispose?.();
      if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
      else process.env.QUIRKS_STATE_DIR = previousStateDir;
    },
  };
}

export function featureTaskCandidate(fixture: ContextualFixture): NativeTaskCandidate {
  return {
    id: FEATURE_TASK_ID,
    title: "Implement contextual copy prompts and brainstorm task materialization",
    kind: "implementation",
    priority: "P1",
    status: "ready",
    dependsOn: [],
    workflow: { family: "superpowers", phase: "execute", designGate: { required: false } },
    execution: {
      effort: "standard",
      risk: [],
      capabilities: ["repository-write"],
      parallelismKeys: ["contextual-prompts"],
      humanGates: [],
      completionBoundary: "accepted-commit",
    },
    sourceRefs: [{ kind: "spec", path: SPEC_PATH, commit: fixture.planCommit }],
    deliverables: ["Contextual copy prompts"],
    acceptanceCriteria: ["Every key context exposes one recommended copy action"],
    verification: ["pnpm check"],
    provenance: { schemaVersion: 1, iterations: [] },
    coordination: null,
    statusDetail: null,
  };
}

export async function materializeContextualPromptFeature(
  fixture: ContextualFixture,
): Promise<MaterializedTask> {
  const result = await materializePlannedTasks({
    source: fixture.source,
    idempotencyNamespace: "brainstorm:contextual-prompts",
    proposals: [{
      task: featureTaskCandidate(fixture),
      plan: { path: PLAN_PATH, commit: fixture.planCommit, tasks: [...PLAN_TASK_NUMBERS] },
    }],
  });
  return result[0]!;
}
