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

QK-COMP-002 adds the shaping-specific screens: the proposed goal/task tree preview and
the alternatives comparison. Until it lands, compose them from the pieces above.

## Stopping

```bash
.claude/skills/shape/scripts/stop-server.sh <session_dir>
```

Project-dir sessions keep their files for later reference; `/tmp` sessions are deleted.
