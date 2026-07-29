// The titlebar band (QK-NAT-010) and the focus-mode switcher (QK-NAT-014).
//
// This is the native workbench's header row, which was not "a header above the
// app" but the window's titlebar itself (`.titlebar = "hidden_inset_tall"` in
// app.zon, `window-drag="true"` on the row, traffic-light insets arriving as
// `chrome_changed`). The browser has the same three ingredients — a drag
// region, Window Controls Overlay insets, and a band that owns the top edge —
// so the band is built the same way and simply reads as a header wherever the
// shell keeps its own titlebar.
//
// The controls are a straight port of app.native's header buttons, including
// the gesture split that made them work at all:
//
//     <button icon="panel-left"  on-press="toggleLedger"   on-hold="focusLedger"  />
//     <button icon="terminal"    on-press="focusTerminal"  on-hold="focusTerminal"/>
//     <button icon="panel-right" on-press="toggleShape"    on-hold="focusShape"   />
//
// Press collapses, hold takes the stage. A hold is invisible and unreachable
// by keyboard, though, so this adds Alt/Option-click as an equal path to the
// same action and says so in every control's tooltip — the native host had a
// pointer and nothing else; a browser has to answer to more than that.

import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { CircleDot, PanelLeft, PanelRight, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type * as React from "react";

import { Badge } from "~/components/ui/badge";
import { runIsLive, runProgress } from "~/lib/runs";
import { cn } from "~/lib/utils";
import { ledgerAtom } from "~/state/ledger";
import { runsAtom } from "~/state/runs";
import { paneFocused, paneParked, useLayoutStore, type FocusPane } from "~/stores/layout";

/** Long enough not to fire on a normal click, short enough to feel deliberate. */
const HOLD_MS = 350;

export function Titlebar() {
  const focus = useLayoutStore((state) => state.focus);
  const ledgerHidden = useLayoutStore((state) => state.ledgerHidden);
  const shapeHidden = useLayoutStore((state) => state.shapeHidden);
  const toggleLedger = useLayoutStore((state) => state.toggleLedger);
  const toggleShape = useLayoutStore((state) => state.toggleShape);
  const focusPane = useLayoutStore((state) => state.focusPane);

  const layout = { focus, ledgerHidden, shapeHidden };

  return (
    <header
      // `drag-region` is the whole point of a titlebar band: the empty parts
      // move the window, the controls do not (each opts out below).
      className="drag-region flex shrink-0 items-center gap-2 border-b bg-card px-3"
      style={{ height: "var(--titlebar-height)" }}
    >
      {/* Native `<spacer width="{chromeLeading}" />` — the traffic lights'
          reserved corner, zero-width wherever the shell owns its own bar. */}
      <ChromeInset side="leading" />

      <span className="text-[0.9375rem] font-semibold tracking-tight">Quirks</span>
      <span className="font-mono text-[11px] text-muted-foreground">workbench</span>

      {focus !== "split" && (
        <span className="font-mono text-[10px] text-lamp" title="one pane has the whole stage">
          · {focus} · full bleed
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <LedgerStatus />
        <RunsControl />

        <ChromeControl
          pane="ledger"
          label="Ledger"
          icon={<PanelLeft />}
          // Native bound `selected="{ledgerOpen}"` — lit means "on the stage",
          // which is the collapse flag, not the focus mode.
          selected={!paneParked(layout, "ledger")}
          focused={paneFocused(layout, "ledger")}
          onPress={toggleLedger}
          onFocusPane={focusPane}
        />
        <ChromeControl
          pane="terminal"
          label="Terminal"
          icon={<SquareTerminal />}
          // The terminal has no collapse — press and hold were both
          // `focusTerminal` in the native markup, so pressing it is the
          // full-bleed toggle and nothing else.
          selected={paneFocused(layout, "terminal")}
          focused={paneFocused(layout, "terminal")}
          onPress={() => focusPane("terminal")}
          onFocusPane={focusPane}
        />
        <ChromeControl
          pane="shape"
          label="Shape"
          icon={<PanelRight />}
          selected={!paneParked(layout, "shape")}
          focused={paneFocused(layout, "shape")}
          onPress={toggleShape}
          onFocusPane={focusPane}
        />
      </div>

      <ChromeInset side="trailing" />
    </header>
  );
}

function ChromeInset({ side }: { side: "leading" | "trailing" }) {
  return (
    <div
      aria-hidden="true"
      className="shrink-0"
      style={{ width: `var(--chrome-${side})` }}
      data-chrome-inset={side}
    />
  );
}

// ---------------------------------------------------------------------------
// the controls
// ---------------------------------------------------------------------------

interface ChromeControlProps {
  readonly pane: FocusPane;
  readonly label: string;
  readonly icon: ReactNode;
  /** Lit: this pane is on the stage (native `selected`). */
  readonly selected: boolean;
  /** Filled: this pane HAS the stage. */
  readonly focused: boolean;
  readonly onPress: () => void;
  readonly onFocusPane: (pane: FocusPane) => void;
}

/**
 * Deliberately not the shadcn `Button`. Its `outline` variant carries a stack
 * of shadow and dark-mode background rules that would have to be unpicked one
 * by one to let a lamp fill through; the band is its own small chrome language
 * (three tones: quiet, lit, filled) and says so in one place.
 */
function ChromeControl({
  pane,
  label,
  icon,
  selected,
  focused,
  onPress,
  onFocusPane,
}: ChromeControlProps) {
  const hold = useHoldPress(onPress, () => onFocusPane(pane));

  return (
    <button
      type="button"
      // Buttons inside a drag region are otherwise draggable furniture.
      className={cn(
        "no-drag-region inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card [&_svg]:size-3.5 [&_svg]:shrink-0",
        focused && "border-lamp-line bg-lamp text-lamp-foreground",
        selected && !focused && "border-lamp-line bg-lamp-soft text-foreground [&_svg]:text-lamp",
        !selected &&
          !focused &&
          "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      aria-pressed={selected}
      data-chrome-control={pane}
      data-focused={focused || undefined}
      title={`${label} — click to ${
        pane === "terminal" ? "toggle full bleed" : focused ? "collapse" : "show or collapse"
      }, hold or ⌥-click for full bleed`}
      {...hold}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Press vs hold on one control.
 *
 * The click handler stays the press path so Enter and Space keep working
 * untouched: a keyboard activation never sends pointerdown, so `held` is false
 * and the press runs. A pointer hold fires the focus action on the timer and
 * then swallows the click that follows the release.
 */
function useHoldPress(
  onPress: () => void,
  onHold: () => void,
): {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (event: React.MouseEvent) => void;
} {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => clear, [clear]);

  return {
    onPointerDown: (event) => {
      // Only a primary press arms the hold; a right-click should not.
      if (event.button !== 0) return;
      held.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        held.current = true;
        onHold();
      }, HOLD_MS);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: (event) => {
      clear();
      if (held.current) {
        held.current = false;
        return;
      }
      // The reachable, announceable equal of a hold.
      if (event.altKey) {
        onHold();
        return;
      }
      onPress();
    },
  };
}

// ---------------------------------------------------------------------------
// the way into the run views (QK-WB-007)
// ---------------------------------------------------------------------------

/**
 * A fourth control, in the band's own three-tone language: quiet, lit (the
 * layer is open), and never filled — the run views are not a pane and cannot
 * take the stage, they cover it.
 *
 * It belongs up here for the same reason `LedgerStatus` does: the band survives
 * every focus mode, so "a run is moving" and "something needs you" stay
 * readable while the Ledger rail is off the stage entirely. Pressing it toggles
 * — open from anywhere, and press again to go back to the workbench, which is
 * the gesture the three controls beside it already teach.
 */
function RunsControl() {
  const navigate = useNavigate();
  const open = useRouterState({ select: (state) => state.location.pathname.startsWith("/runs") });
  const result = useAtomValue(runsAtom);
  const runs = Option.getOrNull(AsyncResult.value(result))?.runs ?? [];
  const live = runs.some((run) => runIsLive(run.status));
  const needsYou = runs.reduce((sum, run) => sum + runProgress(run).needsYou, 0);

  return (
    <button
      type="button"
      onClick={() => void navigate({ to: open ? "/" : "/runs" })}
      aria-pressed={open}
      data-chrome-control="runs"
      title={
        open
          ? "Runs — click to go back to the workbench"
          : `Runs — ${runs.length} recorded${needsYou > 0 ? `, ${needsYou} need you` : ""}`
      }
      className={cn(
        "no-drag-region inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card [&_svg]:size-3.5 [&_svg]:shrink-0",
        open
          ? "border-lamp-line bg-lamp-soft text-foreground [&_svg]:text-lamp"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <CircleDot />
      Runs
      {needsYou > 0 && <span className="font-mono text-[10px] text-ember">{needsYou}</span>}
      {live && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-moss motion-safe:animate-pulse"
        />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// the status the native band carried
// ---------------------------------------------------------------------------

/**
 * The native header's `{ledgerStatus}` badge — loading / live / daemon
 * unreachable. It lives in the band rather than the pane because it must
 * survive the pane: in Terminal or Shape focus the ledger is off the stage,
 * and whether the daemon is still answering is exactly the thing you would
 * otherwise have to leave full bleed to find out.
 *
 * The pane keeps the long form (which request failed, and why). This is the
 * one word.
 */
function LedgerStatus() {
  const result = useAtomValue(ledgerAtom);
  const hasSnapshot = Option.isSome(AsyncResult.value(result));
  const failed = AsyncResult.isFailure(result);

  const label = failed ? (hasSnapshot ? "stale" : "unreachable") : hasSnapshot ? "live" : "loading";

  return (
    <Badge
      className={cn("no-drag-region font-mono", failed && !hasSnapshot && "text-ember")}
      title={`ledger: ${label}`}
    >
      {label}
    </Badge>
  );
}
