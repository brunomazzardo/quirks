# Workflow policy for task authoring

## Design gates

- Honor `workflow.designGate.required` from project workflow policy.
- Block proposals that disable or bypass design gates without explicit human approval recorded in the task source.

## Dependencies

- Every `dependsOn` entry must reference an existing task id in the selected source.
- Reject circular or cross-campaign dependency edges.

## Scope

- Task proposals must stay within the approved campaign envelope and must not broaden `parallelismKeys` or execution capabilities without a new approved campaign.

## Provenance

- Record compact `sourceRefs` only—never paste plan or spec bodies into task JSON.

## Visual-reference propagation

For each task proposal, inspect the referenced plan tasks for a Visual references section. Keep visual references optional. When present, copy the governed decisions into bounded acceptance criteria, attach tracked artifacts as commit-pinned `other` sourceRefs, and keep the exact numbered plan refs. If a fidelity-bearing reference defines reproduction rules, propose a distinct verification task depending on every affected implementation task. Responsive fit, accessibility, security, and performance checks do not by themselves prove visual fidelity.

## Plan partition boundaries

- Partition committed plans by independently schedulable or reviewable boundaries, never one queue task per plan heading.
- Each materialized task carries one immutable plan `sourceRefs` entry per numbered plan task it owns, pinned to the exact plan commit.
- No two proposals may claim the same numbered plan task in the same plan.
- Materialization is complete only when every created task has been read back, its refs and workflow verified, and its ID returned to the operator.
