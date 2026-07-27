# The shape companion

A browser surface for shape sessions: the session pushes an HTML screen, the operator
looks and clicks, the session reads the clicks back. **A conversation surface only** —
it shows things that do not exist yet, to help the operator decide. Ledger browsing,
runs, and reports are the native app's job, never this.

Adapted from Superpowers' visual companion (MIT). Vendored here until QK-COMP-003
folds it into the quirks daemon.

## Offering it

Do not offer upfront. The first time a question would genuinely be clearer **seen than
read** — a proposed goal/task tree, two decompositions side by side, an architecture
sketch — offer it as its own message and wait. If the operator declines, stay in the
terminal and don't offer again unless they raise it.

**Per-question test, even after acceptance:** would the operator understand this better
by seeing it? Conceptual, scope, and tradeoff questions stay in the terminal. The
terminal message remains primary either way — every screen gets a one-line summary in
the terminal, and the operator always answers in the terminal.

## The design language — the night ledger

This is a direction system, not a component list. **Compose whatever the question
needs** — a chart, a dependency graph, a timeline, a diff, a table, a comparison
nobody planned for — inside one identity:

Quirks is a ledger of intent reviewed around overnight agent work. Deep ink night
(`--bg`, with `--surface` and `--raised` as elevation), warm paper text (`--text`,
`--text-dim`, `--text-faint`), and **one accent: lamplight amber (`--lamp`)** — the
lamp left on while agents work. The signature on tree screens is the **ledger rail**:
the lit lamp at the goal, a dot per task that lights when marked.

### Rules for composing anything

- **Color is meaning, never decoration.** Amber marks exactly one thing per screen —
  the recommendation, the thing being decided, the bar under discussion. `--moss` is
  good/done/passing; `--ember` is risk/blocked/failing. Everything else stays on the
  neutral ink levels. Never introduce a new hue.
- **Mono is for data; sans is for prose.** Ids, numbers, axis labels, chips,
  done-when lines, verification commands: `var(--mono)` (use
  `font-variant-numeric: tabular-nums` for columns of numbers). Hierarchy comes from
  weight + size together; tracking tightens as type grows.
- **Charts and graphs: build them, honestly.** Inline SVG or plain divs — never an
  external library, font, or image; the page must work with the network cable pulled.
  Bars scale from zero. Label data directly on the mark instead of adding a legend
  when there are few series. Gridlines only when reading a value depends on them.
  The comparison the operator must see gets the amber; everything else recedes.
- **Anything can be clickable.** Put `data-choice="…"` + `onclick="toggleSelect(this)"`
  + `tabindex="0"` on any element — a bar, a row, a node — and the click lands in the
  events file. The recommended choice carries `data-recommended` and the badge.
- **Motion belongs to the frame.** The arrival settle and instant press feedback are
  provided; add nothing else. Reduced motion and reduced transparency are handled.
- **Layout breathes.** The frame centers content in a readable column — don't fight
  it. `.split` puts two things side by side. Prefer whitespace over boxes; a border
  earns its place or goes.
- Use the tokens, never hardcoded colors — light mode (paper ledger) comes free.

Conveniences exist in `scripts/frame-template.html` — `.options`/`.option`, `.cards`,
`.mockup`, `.pros-cons`, `.tree`, `.tid`/`.dep`/`.badge`/`.label` — reach for them
when they fit, compose past them when they don't.

## The one rule screens must honor

**Lead with a direction, never a flat menu.** Exactly one option on any choices screen
carries `data-recommended` and a `<span class="badge">recommended</span>` in its title,
placed first, with the reasoning in its description. This is the terminal conversation's
explain-and-recommend rule carried into the medium.

## Starting

```bash
.claude/skills/shape/scripts/start-server.sh --project-dir "$(git rev-parse --show-toplevel)" --open
```

Returns JSON: `url` (carries `?key=…` — always give the operator the complete URL),
`screen_dir`, `state_dir`. Session files live under `.quirks/shape-sessions/`
(gitignored); the server auto-exits after 4h idle (`--idle-timeout-minutes` to change).
If launched in the background without captured stdout, read `$state_dir/server-info`.

Before every push, confirm `$state_dir/server-info` exists and `$state_dir/server-stopped`
does not. If it stopped, rerun start-server.sh with the same `--project-dir` — it reuses
the port and key, so the operator's open tab reconnects by itself.

## The loop

1. Write an HTML **fragment** to a new file in `screen_dir` (semantic names —
   `tree-preview.html`, `alternatives.html`; never reuse a filename; `-v2` suffix for
   iterations). Fragments are wrapped in the themed frame automatically; only content
   starting `<!DOCTYPE`/`<html` is served bare. Use the file-creation tool, never heredoc.
2. Tell the operator what's on screen (one line), remind them of the URL, and end the
   turn — they answer in the terminal.
3. Next turn, read `$state_dir/events` (JSON lines of clicks; cleared automatically on
   each new screen). Terminal text is primary; events are supporting data. No events
   file means they didn't click.
4. When the conversation returns to terminal-only questions, push a `waiting-N.html`
   ("Continuing in the terminal…") so a resolved choice doesn't linger on screen.

## Screen vocabulary

The frame provides (see `scripts/frame-template.html` for the full CSS):

- `.options` > `.option` with `data-choice`, `onclick="toggleSelect(this)"`, a `.letter`
  chip and `.content` — alternatives. Add `data-multiselect` to the container for
  multi-select. **One option carries `data-recommended` + the badge.**
- `.cards` > `.card` — visual designs with a `.card-image` / `.card-body`.
- `.mockup` (+ `.mockup-header`/`.mockup-body`), `.split` for side-by-side, `.pros-cons`,
  `.placeholder`, `.mock-nav`/`.mock-sidebar`/`.mock-content`/`.mock-button`/`.mock-input`.
- Typography: `h2`, `h3`, `.subtitle`, `.section`, `.label`, `.badge`.

### The tree preview — the session's backlog, before it is recorded

The fragment stays tiny: a heading plus the proposal as JSON. The injected helper draws
the tree right after the JSON block. **The JSON mirrors what you will record through
`goal new` / `task propose` — preview and recording never diverge.**

```html
<h2>What this session proposes</h2>
<p class="subtitle">Click any task you want to discuss before I record. Then answer in the terminal.</p>
<script type="application/json" data-proposal>
{
  "proposals": [
    {
      "goal": { "id": "QK-XYZ", "title": "…", "why": "…", "doneWhen": ["…"] },
      "tasks": [
        { "id": "QK-XYZ-001", "title": "…",
          "deliverables": ["…"], "criteria": ["…"], "verify": ["bun test …"],
          "dependsOn": [], "flags": [], "note": "optional one-liner" },
        { "id": "QK-XYZ-002", "title": "…", "dependsOn": ["QK-XYZ-001"],
          "flags": ["needs-design"] }
      ]
    }
  ]
}
</script>
```

Ids are provisional (they mint at `task propose` time); use the ids you intend. Several
goals in `proposals` render as several trees — a split session shows them all. Task
nodes are multiselect-clickable; each click arrives in `events` as `"choice": "task:<id>"`
meaning **discuss this one**, not approval.

### Alternatives — two decompositions side by side

`.options.split` lays two directions out side by side; each side is a normal `.option`
(so clicks select), and each can embed its own `data-proposal` JSON block to draw a
mini-tree inside. The recommended side carries `data-recommended` + the badge, first.

## Stopping

```bash
.claude/skills/shape/scripts/stop-server.sh <session_dir>
```

Project-dir sessions keep their files for later reference; `/tmp` sessions are deleted.
