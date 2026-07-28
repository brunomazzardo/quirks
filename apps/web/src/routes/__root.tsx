import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootShell,
});

/**
 * The shell chrome every pane hangs off: title bar, then a single flexible
 * stage. Deliberately structural — the workbench theme lands in QK-WB-006.
 */
function RootShell() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-10 shrink-0 items-center gap-2.5 border-b px-3">
        <span className="text-sm font-semibold tracking-tight">quirks</span>
        <span className="font-mono text-[11px] text-muted-foreground">workbench</span>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
