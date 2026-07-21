import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QuirksError } from "../core/errors.js";

const execFileAsync = promisify(execFile);

export interface ImmutableSourceRef {
  kind: "plan";
  path: string;
  commit: string;
  task?: number;
}

export interface PlanStep {
  id: string;
  task: number;
  step: number;
  label: string;
}

export interface PlanTaskOutline {
  task: number;
  label: string;
  steps: readonly PlanStep[];
}

export interface PlanOutline {
  path: string;
  commit: string;
  tasks: readonly PlanTaskOutline[];
}

const STEP_PATTERN = /^- \[ \] \*\*Step (\d+):\s*(.+)\*\*/;
const TASK_PATTERN = /^### Task (\d+):\s*(.+)$/;

export async function loadPlanOutline(root: string, refs: readonly ImmutableSourceRef[]): Promise<PlanOutline> {
  const planRef = refs.find((ref) => ref.kind === "plan");
  if (!planRef) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Plan source ref is required");
  }
  if (planRef.path.includes("..") || planRef.path.startsWith("/")) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Plan path must be repository-relative");
  }

  const { stdout } = await execFileAsync("git", ["-C", root, "show", `${planRef.commit}:${planRef.path}`], {
    maxBuffer: 1024 * 1024,
  });

  const tasks = new Map<number, PlanTaskOutline>();
  let currentTask: number | undefined;

  for (const line of stdout.split("\n")) {
    const taskMatch = TASK_PATTERN.exec(line.trim());
    if (taskMatch) {
      currentTask = Number(taskMatch[1]);
      if (!Number.isInteger(currentTask) || currentTask <= 0) {
        throw new QuirksError("PROTOCOL_VIOLATION", "Invalid task heading in plan");
      }
      if (tasks.has(currentTask)) {
        throw new QuirksError("PROTOCOL_VIOLATION", "Duplicate task heading in plan");
      }
      tasks.set(currentTask, { task: currentTask, label: taskMatch[2]!.trim(), steps: [] });
      continue;
    }

    const stepMatch = STEP_PATTERN.exec(line.trim());
    if (!stepMatch || currentTask === undefined) continue;
    const step = Number(stepMatch[1]);
    const entry = tasks.get(currentTask);
    if (!entry) continue;
    if (entry.steps.some((existing) => existing.step === step)) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Duplicate step in plan task");
    }
    const steps: PlanStep[] = [...entry.steps];
    steps.push({
      id: `task-${currentTask}/step-${step}`,
      task: currentTask,
      step,
      label: stepMatch[2]!.trim().slice(0, 512),
    });
    tasks.set(currentTask, { ...entry, steps });
  }

  const allowedTasks = planRef.task !== undefined ? [planRef.task] : [...tasks.keys()];
  const selected = allowedTasks
    .map((taskNumber) => tasks.get(taskNumber))
    .filter((task): task is PlanTaskOutline => task !== undefined);

  if (selected.length === 0) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Referenced plan tasks were not found");
  }

  return { path: planRef.path, commit: planRef.commit, tasks: selected };
}
