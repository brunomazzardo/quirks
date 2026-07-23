---
name: writing-tasks
description: Author tasks through quirks-tasks validate and propose without direct JSON mutation or scope creep.
---

# Writing tasks

Use this skill when proposing or refining tasks in a Quirks repository.

## Required workflow

1. Run `quirks-tasks validate` before proposing any task change.
2. Create a repository-relative proposal request under `.quirks/requests/` and run `quirks-tasks propose --request-file .quirks/requests/propose-TASK_ID.json --json`—never mutate `.quirks/tasks.json` or provider task files directly.
3. Validate `dependsOn`, design gates, and `workflowPolicy.skills` alignment for every proposal.
4. Reject tasks that broaden campaign scope or weaken design-gate defaults.
5. Submit only compact candidate references for provenance—never embed spec or plan bodies in task records.

## Materializing approved plans

When approved brainstorming hands off committed specifications and plans, materialize them into durable tasks:

1. Validate the selected task source, then propose a task partition from the committed plan set. Split queue tasks only at independently schedulable or reviewable execution and review boundaries—never create one queue task per plan heading. A cohesive feature may be one task whose `sourceRefs` enumerate every applicable numbered plan task.
2. Ask the operator to approve the proposed partition when the number or boundaries of tasks require judgment.
3. Propose each task through TaskSource authority with stable idempotency keys and one immutable plan ref per numbered plan task, pinned to the exact plan commit. Do not stop after writing plan documents: brainstorming output is incomplete until the durable task proposal(s) exist.
4. Read every created task back, verify its immutable source refs and workflow policy, and return the created task IDs with their immutable plan mappings as the terminal output.

## Visual-reference propagation

For each task proposal, inspect the referenced plan tasks for a Visual references section. Keep visual references optional. When present, copy the governed decisions into bounded acceptance criteria, attach tracked artifacts as commit-pinned `other` sourceRefs, and keep the exact numbered plan refs. If a fidelity-bearing reference defines reproduction rules, propose a distinct verification task depending on every affected implementation task. Responsive fit, accessibility, security, and performance checks do not by themselves prove visual fidelity.

## Reference

See `references/workflow-policy.md` for design-gate and dependency checks, and `../../references/task-mutation-requests.md` for the transient request-file schema, operation match, and acknowledgement cleanup rule.

## Prohibited patterns

- Direct JSON task file edits (`bypass_task_source`)
- Skipping required design gates (`skip_design_gate`)
- Unbounded scope creep beyond the approved envelope (`unbounded_scope_creep`)
- Secret-shaped strings in task prose (`secret_in_task_prose`)

## CLI authority

All mechanical authoring flows through `quirks-tasks` with `--json`. Skills never open task source files directly.
