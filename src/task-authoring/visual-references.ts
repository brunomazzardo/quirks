import { QuirksError } from "../core/errors.js";
import { assertRepositoryRelativePath } from "../core/repository-path.js";
import type { SourceRef, VisualReferenceInput } from "./types.js";

const FULL_LOWERCASE_SHA = /^[0-9a-f]{40}$/;

const FORMATS: readonly VisualReferenceInput["format"][] = ["interactive-html", "png", "screenshot-set", "diagram"];

const VERIFICATIONS: readonly VisualReferenceInput["verification"][] = [
  "context-only",
  "structural",
  "screenshot",
  "structural-and-screenshot",
  "manual",
];

/** Verification modes that assert durable evidence about a preserved artifact. */
const DURABLE_EVIDENCE: readonly VisualReferenceInput["verification"][] = [
  "structural",
  "screenshot",
  "structural-and-screenshot",
];

function violation(message: string): QuirksError {
  return new QuirksError("PROTOCOL_VIOLATION", message);
}

function assertReferencePath(reference: VisualReferenceInput): void {
  try {
    assertRepositoryRelativePath(reference.path);
  } catch {
    throw violation(`Visual reference ${reference.id} needs a repository-relative path: ${JSON.stringify(reference.path)}`);
  }
}

function assertPlanTasks(reference: VisualReferenceInput): void {
  if (reference.planTasks.length === 0) {
    throw violation(`Visual reference ${reference.id} must name at least one consuming plan task`);
  }
  const seen = new Set<number>();
  for (const planTask of reference.planTasks) {
    if (!Number.isInteger(planTask) || planTask <= 0) {
      throw violation(`Visual reference ${reference.id} names an invalid plan task number`);
    }
    if (seen.has(planTask)) {
      throw violation(`Visual reference ${reference.id} names duplicate plan task ${planTask}`);
    }
    seen.add(planTask);
  }
}

function assertAvailability(reference: VisualReferenceInput): void {
  if (reference.availability === "tracked") {
    if (!reference.commit || !FULL_LOWERCASE_SHA.test(reference.commit)) {
      throw violation(`Tracked visual reference ${reference.id} needs a full lowercase commit`);
    }
    return;
  }
  if (reference.commit !== undefined) {
    throw violation(`Local visual reference ${reference.id} must not claim a durable commit before preservation`);
  }
  if (DURABLE_EVIDENCE.includes(reference.verification)) {
    throw violation(
      `Local visual reference ${reference.id} cannot claim ${reference.verification} evidence before preservation`,
    );
  }
}

/**
 * Validate the optional visual references attached to one proposal. Visuals stay
 * optional: an empty list is valid and yields no acceptance criteria or refs.
 */
export function validateVisualReferences(
  references: readonly VisualReferenceInput[],
): readonly VisualReferenceInput[] {
  const seenIds = new Set<string>();
  for (const reference of references) {
    if (!reference.id) throw violation("Every visual reference needs a stable id");
    if (seenIds.has(reference.id)) throw violation(`Duplicate visual reference id ${reference.id}`);
    seenIds.add(reference.id);

    assertReferencePath(reference);
    if (!FORMATS.includes(reference.format)) {
      throw violation(`Visual reference ${reference.id} has an unsupported format ${JSON.stringify(reference.format)}`);
    }
    if (!VERIFICATIONS.includes(reference.verification)) {
      throw violation(
        `Visual reference ${reference.id} has an unsupported verification method ${JSON.stringify(reference.verification)}`,
      );
    }
    if (reference.governs.length === 0) {
      throw violation(`Visual reference ${reference.id} must name at least one governed decision`);
    }
    assertPlanTasks(reference);
    assertAvailability(reference);
  }
  return references;
}

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function governedPlanTasks(reference: VisualReferenceInput, planTasks: readonly number[]): number[] {
  return reference.planTasks.filter((planTask) => planTasks.includes(planTask)).toSorted((left, right) => left - right);
}

/** True when the reference governs at least one plan task the proposal owns. */
export function governsAnyPlanTask(reference: VisualReferenceInput, planTasks: readonly number[]): boolean {
  return governedPlanTasks(reference, planTasks).length > 0;
}

/** True when the reference asserts fidelity that a separate verification task must prove. */
export function isFidelityBearing(reference: VisualReferenceInput): boolean {
  return reference.verification !== "context-only";
}

/**
 * Bounded acceptance criteria naming each governing reference, the decisions it
 * governs, and the exact numbered plan tasks the proposal owns.
 */
export function visualAcceptanceCriteria(
  references: readonly VisualReferenceInput[],
  planTasks: readonly number[],
): string[] {
  const criteria: string[] = [];
  for (const reference of references) {
    const governed = governedPlanTasks(reference, planTasks);
    if (governed.length === 0) continue;
    const label = governed.length === 1 ? "Task" : "Tasks";
    criteria.push(
      `Conform to ${reference.id} for ${formatList([...reference.governs])} per plan ${label} ${formatList(governed.map(String))}`,
    );
  }
  return criteria;
}

/** Commit-pinned `other` refs for the tracked subset of the governing references. */
export function visualSourceRefs(references: readonly VisualReferenceInput[]): SourceRef[] {
  return references
    .filter((reference) => reference.availability === "tracked")
    .map((reference) => ({
      kind: "other" as const,
      path: reference.path,
      commit: reference.commit!,
      section: reference.id,
    }));
}
