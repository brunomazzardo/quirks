import { createFileRoute } from "@tanstack/react-router";

import { LedgerPane } from "~/components/ledger-pane";
import { ShapePane } from "~/components/shape-pane";
import { TerminalPane } from "~/components/terminal-pane";

export const Route = createFileRoute("/")({
  component: WorkbenchRoute,
});

function WorkbenchRoute() {
  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <LedgerPane />

      {/*
        Terminal and Shape share a nested row rather than each taking a plain
        third of the outer row — mirroring the native `rightSplit` (Terminal +
        Shape only; Ledger's `leftSplit` is independent). Hiding Shape
        (QK-NAT-008) then hands its share back to Terminal specifically,
        not to Ledger.
      */}
      <div className="flex min-w-0 flex-[2] gap-3">
        <TerminalPane />

        <ShapePane />
      </div>
    </div>
  );
}
