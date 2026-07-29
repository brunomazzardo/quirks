import { create } from "zustand";

/**
 * The workbench's chrome state: which panes are collapsed, and which one (if
 * any) has the whole stage. Ported from the native workbench's layout arms in
 * apps/workbench/src/core.ts.
 *
 * TWO LAYERS, deliberately independent
 *
 *   collapse (QK-NAT-008 / QK-NAT-013) — Ledger and Shape can each be parked
 *   to an edge tab, handing their width to a sibling. Shape parks right and
 *   feeds the Terminal; Ledger parks left and feeds the Terminal+Shape group.
 *   The native model held these as `shapeOpen` / `ledgerOpen` driving
 *   `rightSplit` / `leftSplit`; `shapeHidden` / `ledgerHidden` are their
 *   mirrors (`false` is the native `*Open: true`).
 *
 *   focus (QK-NAT-014) — one pane edge to edge under the chrome band, the
 *   others gone. `focus: "split"` is "no focus mode", the normal three-pane
 *   stage.
 *
 * Focus WINS while it is on and CHANGES NOTHING underneath it, so leaving a
 * focus mode drops you back into the exact stage you left. That is what
 * QK-NAT-013's acceptance asked for in words — "collapse is independent of
 * focus mode (focus can still override later)" — and it is the one place this
 * store deliberately does not copy core.ts's code: there, entering Terminal
 * focus assigned `ledgerOpen: false, shapeOpen: false` and every exit path
 * forced `ledgerOpen: true`, so a peek at the terminal silently discarded a
 * collapsed Shape and re-opened a collapsed Ledger. Same modes, same controls;
 * the state they trample is the difference.
 *
 * The one native guarantee that survives verbatim is in the toggles: pressing
 * a collapse control while focused leaves focus AND reveals that pane
 * (core.ts `toggleLedger` / `toggleShape`). So the pane whose control you
 * pressed is always the pane you end up looking at, and no sequence of
 * presses can strand you in a stage with nothing in it.
 */

export type FocusMode = "split" | "ledger" | "terminal" | "shape";

/** The panes that can take the whole stage — `FocusMode` less its "off". */
export type FocusPane = Exclude<FocusMode, "split">;

/** The layout facts, without the actions — what the pure selectors read. */
export interface LayoutSnapshot {
  readonly focus: FocusMode;
  readonly ledgerHidden: boolean;
  readonly shapeHidden: boolean;
}

interface LayoutState extends LayoutSnapshot {
  /** Native `toggleLedger`: collapse/expand in split, or leave focus showing the Ledger. */
  toggleLedger: () => void;
  /** Native `toggleShape`: collapse/expand in split, or leave focus showing Shape. */
  toggleShape: () => void;
  /** Native `focusLedger` / `focusTerminal` / `focusShape` — pressing the live one exits. */
  focusPane: (pane: FocusPane) => void;
  /** Native `exitFocus` (Esc): back to the split stage, collapses untouched. */
  exitFocus: () => void;
}

export const INITIAL_LAYOUT: LayoutSnapshot = {
  focus: "split",
  ledgerHidden: false,
  shapeHidden: false,
};

export const useLayoutStore = create<LayoutState>((set) => ({
  ...INITIAL_LAYOUT,

  toggleLedger: () =>
    set((state) =>
      state.focus === "split"
        ? { ledgerHidden: !state.ledgerHidden }
        : { focus: "split", ledgerHidden: false },
    ),

  toggleShape: () =>
    set((state) =>
      state.focus === "split"
        ? { shapeHidden: !state.shapeHidden }
        : { focus: "split", shapeHidden: false },
    ),

  focusPane: (pane) => set((state) => ({ focus: state.focus === pane ? "split" : pane })),

  exitFocus: () => set((state) => (state.focus === "split" ? {} : { focus: "split" })),
}));

// ---------------------------------------------------------------------------
// what the stage should render
//
// Pure functions of a snapshot rather than store methods: the layout rules are
// the part worth testing, and this keeps them readable in one place instead of
// spread across three components' class names.
// ---------------------------------------------------------------------------

/** Is this pane on screen at all — full-bleed, or as one column of the split? */
export function paneVisible(layout: LayoutSnapshot, pane: FocusPane): boolean {
  if (layout.focus !== "split") return layout.focus === pane;
  if (pane === "ledger") return !layout.ledgerHidden;
  if (pane === "shape") return !layout.shapeHidden;
  return true;
}

/**
 * Is this pane collapsed to its edge tab? Only in the split stage — a focus
 * mode is one surface edge to edge, so the other panes' tabs go with them
 * rather than lingering as rails around a "full-bleed" pane.
 */
export function paneParked(layout: LayoutSnapshot, pane: FocusPane): boolean {
  if (layout.focus !== "split") return false;
  if (pane === "ledger") return layout.ledgerHidden;
  if (pane === "shape") return layout.shapeHidden;
  return false;
}

/** Is this pane the one holding the whole stage? Drives the chrome's lit control. */
export function paneFocused(layout: LayoutSnapshot, pane: FocusPane): boolean {
  return layout.focus === pane;
}

/**
 * Does this pane occupy any of the stage — as itself, or as its edge tab?
 *
 * The distinction `paneVisible` does not make, and the one the layout needs:
 * a collapsed pane is not showing its contents but is still very much on the
 * stage, holding the rail you click to bring it back. Only a pane a focus mode
 * has taken off the stage entirely is truly gone.
 */
export function paneOnStage(layout: LayoutSnapshot, pane: FocusPane): boolean {
  return paneVisible(layout, pane) || paneParked(layout, pane);
}
