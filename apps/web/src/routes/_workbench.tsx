import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { LedgerPane } from "~/components/ledger-pane";
import { ShapePane } from "~/components/shape-pane";
import { TerminalPane } from "~/components/terminal-pane";
import { paneOnStage, useLayoutStore } from "~/stores/layout";

export const Route = createFileRoute("/_workbench")({
  component: WorkbenchLayout,
});

/**
 * The stage (QK-NAT-010 chrome, QK-NAT-013/014 layout).
 *
 * Panes sit flush and are separated by hairlines rather than floating as
 * rounded cards: `gap-px` over a `bg-border` container is the CSS spelling of
 * the native `<split gap="1">`, with the container's own colour showing
 * through the one-pixel gaps. That is also what makes "full bleed" mean
 * something — with no stage padding, one pane really does reach every edge.
 *
 * Terminal and Shape share a nested row rather than each taking a plain third
 * of the outer row, mirroring the native `rightSplit` (Terminal + Shape only;
 * Ledger's `leftSplit` is independent). Collapsing Shape (QK-NAT-008) hands
 * its width to the Terminal specifically, and collapsing the Ledger
 * (QK-NAT-013) hands its width to that pair.
 *
 * EVERY PANE STAYS MOUNTED. Visibility is CSS, never conditional rendering,
 * because these panes own live things a re-mount would cost you: xterm's
 * scrollback and alt-screen (the daemon's replay buffer is 256 KiB, so a
 * re-attach truncates history), and the Shape iframe's page, which would
 * reload on every focus switch. The native workbench solved the same problem
 * the same way — it parked the preview webview at 1×1 rather than destroying
 * it (app.zon) — so this is the port, not a shortcut around one.
 *
 * QK-WB-007 is why this is a PATHLESS LAYOUT ROUTE rather than the index route
 * it used to be. The run views wanted their own URLs (/runs, /runs/$runId), and
 * a sibling route would have unmounted all three panes on every visit —
 * breaking the invariant three paragraphs up. As a layout, the stage outlives
 * every child route: `/` renders nothing over it, and the run routes render an
 * opaque layer above it while the terminal keeps its scrollback underneath.
 */
function WorkbenchLayout() {
  const focus = useLayoutStore((state) => state.focus);
  const ledgerHidden = useLayoutStore((state) => state.ledgerHidden);
  const shapeHidden = useLayoutStore((state) => state.shapeHidden);

  // The one thing the stage needs to know about its overlay: whether it is
  // covered. Read off the URL rather than passed down, because the router is
  // the thing that decides it. `inert` is not decoration — a covered pane that
  // still answered Tab would hand focus to a terminal nobody can see.
  const covered = useRouterState({
    select: (state) => state.location.pathname.startsWith("/runs"),
  });

  const layout = { focus, ledgerHidden, shapeHidden };

  return (
    <div className="relative h-full min-h-0">
      <div className="flex h-full min-h-0 gap-px bg-border" inert={covered}>
        {/* `paneOnStage`, not `paneVisible`: a collapsed pane still holds its
            edge tab here, and it is the pane itself that renders the tab. Only
            a focus mode takes a pane off the stage outright. */}
        <Slot show={paneOnStage(layout, "ledger")}>
          <LedgerPane />
        </Slot>

        {/* The right-hand split. It goes with the Ledger when the Ledger is the
            full-bleed pane, and otherwise takes whatever the Ledger is not
            using — including all of it, when the Ledger is off the stage. */}
        <Slot show={focus !== "ledger"}>
          <div className="flex min-w-0 flex-[2] gap-px bg-border">
            <Slot show={paneOnStage(layout, "terminal")}>
              <TerminalPane />
            </Slot>
            <Slot show={paneOnStage(layout, "shape")}>
              <ShapePane />
            </Slot>
          </div>
        </Slot>
      </div>

      <Outlet />
    </div>
  );
}

/**
 * Show or hide a pane without touching its place in the tree.
 *
 * `display: contents` makes this wrapper vanish from layout, so the pane's own
 * sizing (`flex-1` when open, a fixed-width rail when parked) still applies
 * against the real flex row — a hidden pane simply stops producing a gap, and
 * the hairlines close up on their own.
 */
function Slot({ show, children }: { show: boolean; children: ReactNode }) {
  return <div className={show ? "contents" : "hidden"}>{children}</div>;
}
