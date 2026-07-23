---
name: delegated-brainstorming
description: Delegate design brainstorming with frozen envelopes, principal architect tiers, and independent qualified review.
---

# Delegated brainstorming

Use this skill when a campaign task uses delegated design mode. Human-guided design continues through the installed Superpowers brainstorming workflow unchanged.

## Artifact sequence (required)

Preserve the full design sequence:

```text
context discovery → questions/assumptions → alternatives → proposed design
→ written specification → self-review → independent design review → plan gate
→ committed plan(s) → approved task partition → durable task proposal(s)
```

Delegated mode replaces human checkpoints only with the exact campaign approval envelope and an independent qualified reviewer. Never claim a human reviewed a specification when design was delegated. Do not attribute human-reviewed status to delegated design output.

## Terminal output

Brainstorming does not finish when prose artifacts are written. Its successful terminal output is an approved specification, one or more committed plans, one or more durable Quirks task records created through the writing-tasks workflow, and the created task IDs returned to the operator. Stopping after the specification and plan documents is a violation. Invoke the writing-tasks skill to propose an approved task partition from the committed plan set; do not expand the approved scope while partitioning tasks.

## Optional visual references

Visual references are optional. When no visual artifact materially governs the design, require none and add no visual-reference section.

When an approved mock, screenshot, diagram, or comparison governs a material decision, the specification and plan must include a Visual references section naming its availability, exact path, format, governed decisions, consuming plan tasks, and verification method. Never discover references by scanning ignored brainstorm directories. Local references remain honest local paths until a consuming task preserves them; tracked references use full commit-pinned paths.

## Review independence

- The principal architect drafts specifications and plans.
- An independent qualified reviewer performs design review—never the same agent that authored the specification.
- Self-review alone does not satisfy the independent design review gate.
- Stop immediately on decision envelope escape; do not broaden scope at runtime.

## Decision envelope

- Treat the approved decision envelope as frozen after campaign approval.
- Reject envelope escape: no runtime scope expansion, new alternatives outside the envelope, or reinterpretation of delegated decisions.
- Surface envelope conflicts to the supervisor; do not patch around them in skill prose.

## Model routing

Route delegated specification work to principal-tier architects per `../../references/model-routing.md`. Reviewers must meet independence and tier requirements from the approved envelope.

## Reference

See `references/design-sequence.md` for the delegated artifact sequence and principal author expectations.

## Prohibited patterns

- Architect self-review without independent qualified reviewer (`architect_self_review`)
- Runtime decision envelope escape (`envelope_escape`)
- Skipping independent design review (`skipped_independent_review`)
- False human attribution for delegated review (`false_human_attribution`)

## CLI authority

Mechanical campaign state and approval binding use `quirks-campaign` with `--json`. Skills never open campaign journals or task files directly.
