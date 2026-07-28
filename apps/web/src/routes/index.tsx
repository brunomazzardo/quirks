import type { GoalRollup } from "@quirks/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { ListChecks, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";

import { ShapePane } from "~/components/shape-pane";
import { Button } from "~/components/ui/button";

export const Route = createFileRoute("/")({
  component: WorkbenchRoute,
});

// The type-only wire boundary (D3a): apps/web knows the shape of what
// apps/server serves and imports nothing else from it. The rows below are
// static placeholders — QK-WB-003 replaces them with GET /v1/goals.
const placeholderGoals: readonly GoalRollup[] = [
  {
    id: "QK-WB",
    title: "the workbench",
    recorded: true,
    state: "active",
    total: 8,
    done: 1,
    open: 7,
    blocked: 0,
    future: 0,
  },
  {
    id: "QK-MONO",
    title: "the monorepo migration",
    recorded: true,
    state: "active",
    total: 7,
    done: 3,
    open: 4,
    blocked: 0,
    future: 0,
  },
];

function WorkbenchRoute() {
  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <Pane title="Ledger" icon={<ListChecks />} taskId="QK-WB-003">
        <ul className="flex flex-col gap-1.5">
          {placeholderGoals.map((goal) => (
            <li key={goal.id} className="flex items-baseline gap-2 font-mono text-xs">
              <span className="text-foreground">{goal.id}</span>
              <span className="truncate text-muted-foreground">{goal.title ?? "untitled"}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {goal.done}/{goal.total}
              </span>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" disabled className="mt-3 self-start">
          Refresh
        </Button>
      </Pane>

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
