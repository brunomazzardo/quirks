// The shell both run views hang inside (QK-WB-007).
//
// WHY AN OVERLAY AND NOT A PLAIN ROUTE. routes/index.tsx states the workbench's
// one hard invariant in capitals — EVERY PANE STAYS MOUNTED — because the panes
// own live things a re-mount costs you: xterm's scrollback (the daemon's replay
// buffer is 256 KiB, so a re-attach truncates history) and the Shape iframe's
// page. A sibling route at /runs would unmount all three every time you looked
// at a run. So the stage moved under a pathless layout route that never
// unmounts, and the run views render as a layer above it — their own routes,
// their own URLs, deep-linkable and back-button-able, and the terminal keeps
// its history while you read the night's report.
//
// The layer is opaque and takes the whole stage: a run report is a wall of
// evidence and needs the room. The titlebar stays, because it is the window's
// own bar and carries the ledger's up/down word.

import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, CircleDot, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "~/components/ui/button";

export function RunsOverlay({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const isDetail = useRouterState({
    select: (state) => state.location.pathname.replace(/\/+$/, "") !== "/runs",
  });
  const container = useRef<HTMLDivElement>(null);

  // The stage behind this is `inert` (routes/_workbench.tsx), so focus must
  // come in with the layer or a keyboard lands nowhere at all.
  useEffect(() => {
    container.current?.focus();
  }, []);

  useCloseOnEscape(() => void navigate({ to: "/" }));

  return (
    <div
      ref={container}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Runs"
      data-runs-overlay=""
      // Enter-only: a 200ms rise-and-fade bridges the full-stage cut. Exit
      // stays instant on purpose — the layer unmounts on Esc, and a
      // keyboard-initiated close must never wait on an animation.
      className="absolute inset-0 z-20 flex flex-col bg-background outline-none transition-[opacity,translate] duration-200 ease-out starting:opacity-0 motion-safe:starting:translate-y-1"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3 [&_svg]:size-3.5">
        <CircleDot className="text-muted-foreground" />
        {isDetail ? (
          <Link
            to="/runs"
            className="flex items-center gap-1 text-xs font-medium tracking-tight text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft />
            Runs
          </Link>
        ) : (
          <h2 className="text-xs font-medium tracking-tight">Runs</h2>
        )}

        <span className="ml-auto" />
        <Button
          size="icon-sm"
          variant="ghost"
          render={<Link to="/" />}
          aria-label="Close runs"
          title="Close runs (Esc)"
        >
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * Esc closes the layer.
 *
 * CAPTURE phase, and it marks the event handled. __root.tsx listens for the
 * same key on the way back up to leave a focus mode, and unhandled Esc would
 * do both things at once — close the report AND rearrange the stage behind it.
 * Running first and calling `preventDefault` is what lets the root's own guard
 * (`event.defaultPrevented`) stand down, so one key does one thing.
 *
 * The exclusions are the root's, for the root's reason: a text field and a menu
 * both have a prior claim on Esc, and taking it from them is a worse bug than a
 * missing shortcut.
 */
function useCloseOnEscape(close: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest("input, textarea, select, [contenteditable]") !== null) return;
        if (target.closest('[role="menu"], [role="listbox"], [data-open]') !== null) return;
      }
      event.preventDefault();
      close();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [close]);
}
