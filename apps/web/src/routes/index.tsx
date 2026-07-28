import { createFileRoute } from "@tanstack/react-router";
import { SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";

import { LedgerPane } from "~/components/ledger-pane";
import { ShapePane } from "~/components/shape-pane";

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
        <Pane title="Terminal" icon={<SquareTerminal />} taskId="QK-WB-004">
          <p className="font-mono text-xs text-muted-foreground">
            pty sessions, xterm rendering, scrollback.
          </p>
        </Pane>

        <ShapePane />
      </div>
    </div>
  );
}

interface PaneProps {
  title: string;
  icon: ReactNode;
  /** The ledger task that fills this pane in, so the placeholder names its owner. */
  taskId: string;
  children: ReactNode;
}

function Pane({ title, icon, taskId, children }: PaneProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card text-card-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
        {icon}
        <h2 className="text-xs font-medium tracking-tight">{title}</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{taskId}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">{children}</div>
    </section>
  );
}
