---
name: writing-tasks
description: Author tasks through quirks-tasks validate and propose without direct JSON mutation or scope creep.
---

# Writing tasks

Use this skill when proposing or refining tasks in a Quirks repository.

## Required workflow

1. Run `quirks-tasks validate` before proposing any task change.
2. Use semantic `quirks-tasks propose` (or the documented CLI path)—never mutate `.quirks/tasks.json` or provider task files directly.
3. Validate `dependsOn`, design gates, and `workflowPolicy.skills` alignment for every proposal.
4. Reject tasks that broaden campaign scope or weaken design-gate defaults.
5. Submit only compact candidate references for provenance—never embed spec or plan bodies in task records.

## Reference

See `references/workflow-policy.md` for design-gate and dependency checks.

## Prohibited patterns

- Direct JSON task file edits (`bypass_task_source`)
- Skipping required design gates (`skip_design_gate`)
- Unbounded scope creep beyond the approved envelope (`unbounded_scope_creep`)
- Secret-shaped strings in task prose (`secret_in_task_prose`)

## CLI authority

All mechanical authoring flows through `quirks-tasks` with `--json`. Skills never open task source files directly.
