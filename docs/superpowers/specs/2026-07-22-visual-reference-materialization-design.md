# Visual Reference Materialization Design

**Date:** 2026-07-22  
**Status:** Approved design  
**Scope:** Preserve relevant visual-design references from brainstorming through specifications, plans, generated Quirks tasks, and verification.

## 1. Summary

Quirks brainstorming may produce visual artifacts such as interactive HTML mocks, screenshots, diagrams, or comparison boards. These artifacts remain optional: a brainstorm is not required to create a visual design. When relevant visual artifacts do exist, however, the written specification and implementation plan must not silently discard them.

The brainstorm-to-task materialization flow will carry each relevant visual reference into the authoritative written artifacts, bind it to the plan tasks whose behavior or presentation it governs, and create bounded visual-verification work when the agreed design can be reproduced or compared. Visual fidelity is distinct from security, accessibility, responsive-fit, and performance verification; passing those gates does not prove conformance to an approved mock.

## 2. Goals

- Preserve relevant visual decisions across context discovery, specification, planning, task materialization, implementation, and verification.
- Keep visual design optional rather than making mock creation a universal brainstorm gate.
- Distinguish tracked, commit-pinned references from local or ignored brainstorm artifacts.
- Make the relationship between a reference and the plan tasks it governs explicit.
- Generate visual-verification work when an agreed reference supports reproducible comparison.
- Require honest bounded manual comparison when automated visual verification is impractical.
- Prevent irrelevant, stale, or merely decorative artifacts from becoming implementation authority.

## 3. Non-goals

- Requiring every brainstorm to create mocks, screenshots, or diagrams.
- Automatically scanning the filesystem and attaching files based only on names or extensions.
- Adding a new task-schema field in the first implementation.
- Treating pixel equality as the only acceptable visual-verification method.
- Replacing accessibility, responsive-layout, security, interaction, or performance tests with screenshot comparison.
- Copying ignored brainstorm directories wholesale into Git without review.

## 4. Optional visual-reference contract

A specification or plan includes a `Visual references` section only when one or more visual artifacts materially constrain the proposed result. Each entry records:

- a stable label;
- its repository-relative path when tracked, or its explicit local path when still untracked;
- availability: `tracked` or `local`;
- the artifact format, such as interactive HTML, PNG, screenshot set, or diagram;
- the decisions it governs, such as navigation, information hierarchy, density, component composition, responsive behavior, or interaction state;
- the plan tasks that consume it; and
- the intended verification method, or an explicit statement that it is contextual rather than fidelity-bearing.

An artifact is relevant only when the specification identifies at least one concrete decision it governs. Decorative inspiration, superseded alternatives, and unrelated brainstorm output are excluded.

## 5. Tracked and local references

Tracked visual artifacts use commit-pinned repository references wherever Quirks already supports them. The plan names the exact path and consuming task numbers.

Local or ignored artifacts may remain references during design and planning, but the plan must:

1. name their exact location and availability honestly;
2. avoid describing them as durable or commit-pinned;
3. identify which task depends on them; and
4. include preservation as the first step of the earliest consuming task, or as a prerequisite task when several tasks share the artifact.

Preservation means reviewing the artifact, removing credentials or personal data, placing the approved artifact under a tracked design/reference directory, and updating later references to the resulting commit-pinned path. Planning may proceed while the artifact is local; implementation must not claim durable visual evidence until preservation is complete.

## 6. Brainstorming and planning behavior

Human-guided and delegated brainstorming use the same reference contract. Delegated mode remains bound by its frozen decision envelope and independent design-review rules.

Before completing a written specification, brainstorming checks whether visual artifacts were used to approve or explain material decisions. If none were used, no visual-reference section is required. If they were used, the specification records the relevant subset and the decisions each artifact governs.

The implementation plan then maps every fidelity-bearing reference to exact plan tasks. A task implementer must be able to determine, from their task and its referenced plan section, which visual decisions apply without searching an ignored brainstorm tree.

## 7. Task materialization

When approved brainstorming materializes Quirks tasks:

- generated implementation tasks retain their existing commit-pinned specification and plan source references;
- acceptance criteria name the relevant plan task or visual-reference section when visual decisions apply;
- tracked visual artifacts may also receive direct commit-pinned task references where the existing reference model permits;
- local visual artifacts remain referenced through the written plan until preserved; and
- materialization creates a distinct visual-verification task when one or more fidelity-bearing references have a reproducible comparison method.

The visual-verification task depends on every implementation task that affects the referenced surface. It does not become a generic UI test task and does not absorb unrelated accessibility, security, or performance gates.

## 8. Visual-verification methods

Verification selects the narrowest method that proves the agreed decisions:

1. **Automated structural assertions:** viewport, hierarchy, presence, ordering, sizing bounds, interaction states, or responsive transformations derived from the agreed reference.
2. **Screenshot comparison:** deterministic fixtures, fixed viewports, stable fonts/assets, and reviewed tolerances when pixel or perceptual comparison is reliable.
3. **Reproduction-rule comparison:** render both the reference and implementation under documented viewport, data, state, theme, and interaction rules; compare the governed decisions and retain bounded evidence.
4. **Manual visual review:** when automation is impractical, give exact setup steps, reference paths, viewports/states, a decision checklist, reviewer identity requirements, and the evidence to retain.

The task must never claim visual fidelity from `no horizontal overflow`, accessibility checks, snapshot existence, or a test process exiting successfully unless those checks directly cover the agreed visual decisions.

## 9. Failure and degradation behavior

- Missing local artifact: block only the consuming fidelity work, report the missing path, and do not silently omit the reference.
- Superseded artifact: record the replacement explicitly and update the specification/plan before implementation continues.
- Non-reproducible mock: preserve it as contextual evidence, state which decisions remain authoritative, and use bounded manual review.
- Conflicting references: stop at the design or plan gate and resolve which artifact governs each decision.
- Unsafe artifact: do not commit it until credentials, personal data, remote dependencies, and unsafe active content are removed or bounded.

## 10. Existing Quirks UI recovery

The current Quirks UI mocks under ignored `.superpowers/brainstorm/**/content/` are local evidence, not durable repository artifacts. The follow-on implementation plan must:

1. review and preserve the approved approval-workspace, tasks/campaigns, and task-history references in a tracked location;
2. bind them to the existing UI implementation surfaces;
3. define a dedicated task to bring the shipped UI into conformance with the agreed visual system; and
4. define a dependent visual-verification task using fixed fixtures and documented desktop/compact reproduction rules.

This recovery work must preserve the shipped loopback security and authorization boundaries.

## 11. Acceptance criteria

- Brainstorms without relevant visual artifacts remain valid and require no visual-reference section.
- Brainstorms with relevant visual artifacts record each artifact, availability, governed decisions, and consuming plan tasks.
- No task depends on an unspecified search through ignored brainstorm output.
- Local artifacts are preserved before durable fidelity evidence is claimed.
- Materialization generates visual-verification work when reproducible fidelity-bearing references exist.
- Visual verification records exact reproduction rules and bounded evidence, or an honest manual-review procedure.
- Security, accessibility, responsive fit, performance, and visual fidelity remain separately named gates.
- The existing Quirks UI receives both a visual-conformance implementation task and a dependent visual-verification task.

