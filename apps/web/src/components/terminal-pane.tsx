// The Terminal pane (QK-WB-004) — the reason this migration exists.
//
// The Native SDK workbench could render exactly ONE terminal, via a workaround
// that bound the index-0 engine key by hand, and it had no scrollback at all
// (docs/upstream/native-terminal-gap/single-terminal-workaround.md). Both
// limits were properties of that host. Here a terminal is a tab, tabs are a
// list, and history belongs to xterm — so "two at once, with scrollback" needs
// no cleverness, only a tab strip.
//
// Every tab stays mounted while the pane is open (see TerminalView's container
// comment): switching tabs must not cost you the buffer you were reading.

import { Plus, SquareTerminal, X } from "lucide-react";
import { useCallback, useEffect } from "react";

import { TerminalView } from "~/components/terminal-view";
import { Button } from "~/components/ui/button";
import { forgetSession, killSession } from "~/lib/pty";
import { cn } from "~/lib/utils";
import { useTerminalStore, type TerminalTab } from "~/stores/terminals";

const TASK_ID = "QK-WB-004";

export function TerminalPane() {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeKey = useTerminalStore((state) => state.activeKey);
  const openTab = useTerminalStore((state) => state.openTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const activate = useTerminalStore((state) => state.activate);

  // One terminal is what a terminal pane is for; the "+" is for the second.
  useEffect(() => {
    if (useTerminalStore.getState().tabs.length === 0) openTab();
  }, [openTab]);

  const close = useCallback(
    (tab: TerminalTab) => {
      closeTab(tab.key);
      forgetSession(tab.key);
      // Closing the tab closes the shell. Detaching alone would leave it
      // running in the daemon with nothing able to reach it again — an
      // orphan by another name.
      if (tab.sessionId !== null) void killSession(tab.sessionId);
    },
    [closeTab],
  );

  const active = tabs.find((tab) => tab.key === activeKey) ?? null;

  return (
    // Chrome is `card`, canvas is `background` (QK-NAT-010: the ledger column
    // sat on surface, the terminal on background). The pane's headers are
    // chrome; everything below the tab strip is the shell's own screen.
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b bg-card px-3 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
        <SquareTerminal />
        <h2 className="text-xs font-medium tracking-tight">Terminal</h2>
        <StatusDot tab={active} />
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{TASK_ID}</span>
      </header>

      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b bg-card px-1.5">
        {tabs.map((tab) => (
          <Tab
            key={tab.key}
            tab={tab}
            active={tab.key === activeKey}
            onSelect={() => activate(tab.key)}
            onClose={() => close(tab)}
          />
        ))}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => openTab()}
          aria-label="New terminal"
          title="New terminal"
          className="shrink-0"
        >
          <Plus />
        </Button>
      </div>

      {/* `relative` is load bearing: every TerminalView is absolutely
          positioned inside it so all of them keep real dimensions, which is
          what lets the fit addon measure a tab you are not looking at. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <TerminalView key={tab.key} tabKey={tab.key} active={tab.key === activeKey} />
        ))}
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <p className="font-mono text-xs text-muted-foreground">no terminals open</p>
            <Button size="xs" variant="outline" onClick={() => openTab()}>
              <Plus />
              New terminal
            </Button>
          </div>
        )}
        {active !== null && <Notice tab={active} onRetry={() => reopen(active, openTab, close)} />}
      </div>
    </section>
  );
}

/** Retry is "close this one and open a fresh tab": a session that failed to
 *  start has no id to reconnect to, so there is nothing to resume. */
function reopen(tab: TerminalTab, openTab: () => string, close: (tab: TerminalTab) => void): void {
  close(tab);
  openTab();
}

interface TabProps {
  tab: TerminalTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

function Tab({ tab, active, onSelect, onClose }: TabProps) {
  return (
    <div
      className={cn(
        "group flex h-6 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        className="font-mono text-[11px] leading-none"
        title={tab.sessionId ?? "starting…"}
      >
        {tab.label}
        {tab.status === "exited" && (
          <span className="ml-1 text-muted-foreground/70">·{tab.exitCode}</span>
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close terminal ${tab.label}`}
        title="Close terminal"
        className="rounded p-0.5 text-muted-foreground/60 opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/** Same vocabulary as the Shape pane's liveness dot: a colour and a title, and
 *  nothing that moves. */
function StatusDot({ tab }: { tab: TerminalTab | null }) {
  const status = tab?.status ?? "starting";
  return (
    <span
      aria-hidden="true"
      title={`terminal: ${status}`}
      // Night-ledger's three signals and nothing else: moss passing, the lamp
      // for the one state that is mid-flight, ember failing. Tailwind's stock
      // emerald/amber/red were three more hues than the palette admits.
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "live" && "bg-moss",
        status === "starting" && "bg-muted-foreground/30",
        status === "reconnecting" && "bg-lamp",
        status === "exited" && "bg-muted-foreground/30",
        status === "failed" && "bg-ember",
      )}
    />
  );
}

/**
 * The quiet down-state, overlaid rather than replacing the terminal — the last
 * screen a shell painted is still the most useful thing on the pane when the
 * connection drops, so it stays visible underneath.
 */
function Notice({ tab, onRetry }: { tab: TerminalTab; onRetry: () => void }) {
  if (tab.status !== "failed" && tab.status !== "reconnecting") return null;
  const failed = tab.status === "failed";
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 border-t bg-card/95 px-3 py-1.5">
      <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
        {failed ? "terminal not reachable" : "reconnecting…"}
        {tab.error !== null && <span className="text-muted-foreground/70"> — {tab.error}</span>}
      </p>
      {failed && (
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
