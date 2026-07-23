# Delegated design sequence

Delegated brainstorming preserves the Superpowers artifact sequence:

```text
context discovery → questions/assumptions → alternatives → proposed design
→ written specification → self-review → independent design review → plan gate
→ committed plan(s) → approved task partition → durable task proposal(s)
```

Human-guided design continues to use the installed Superpowers brainstorming workflow unchanged. Delegated mode replaces only human checkpoints with the exact campaign approval envelope and an independent qualified reviewer.

## Durable task materialization

After the plan gate, the committed plan set is partitioned into durable Quirks tasks through the writing-tasks workflow. The partition follows execution and review boundaries, not plan headings: a cohesive feature may become one task whose immutable `sourceRefs` enumerate every applicable numbered plan task. Delegated mode preserves the frozen decision envelope while partitioning and returns the created task IDs as its terminal output.

## Optional visual references

Visual references are optional. When no visual artifact materially governs the design, require none and add no visual-reference section.

When an approved mock, screenshot, diagram, or comparison governs a material decision, the specification and plan must include a Visual references section naming its availability, exact path, format, governed decisions, consuming plan tasks, and verification method. Never discover references by scanning ignored brainstorm directories. Local references remain honest local paths until a consuming task preserves them; tracked references use full commit-pinned paths.

## Principal author tier

Delegated specification work routes to a principal-tier architect (Fable/GPT-5.6 class) per `../../references/model-routing.md`. The architect drafts artifacts; a separate qualified reviewer validates them.

## Envelope discipline

The approved decision envelope is frozen at campaign approval. Workers must not expand scope, add alternatives outside the envelope, or reinterpret delegated decisions at runtime.
