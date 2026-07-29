import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { Titlebar } from "~/components/titlebar";
import { useLayoutStore } from "~/stores/layout";

export const Route = createRootRoute({
  component: RootShell,
});

/**
 * The shell chrome every pane hangs off (QK-WB-006): the titlebar band, a
 * hairline, then a single stage the layout store decides the shape of.
 */
function RootShell() {
  const focus = useLayoutStore((state) => state.focus);
  useExitFocusOnEscape();

  return (
    <div className="flex h-full flex-col bg-background text-foreground" data-focus-mode={focus}>
      <Titlebar />
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * Esc leaves a focus mode — `keyMsg` / the `"key"` arm in core.ts, which
 * mapped `escape` to `exitFocus` unconditionally.
 *
 * Unconditionally is exactly what a browser cannot do here. The native
 * workbench's terminal was a host widget the app decided when to feed; this
 * one is a real xterm wired to a real shell, and Esc is the most load-bearing
 * key a shell has — swallowing it would break vim, readline's meta prefix, and
 * every TUI on the machine, which is a far worse bug than a missing shortcut.
 * So the terminal keeps its Esc, and the way out of Terminal focus is the
 * header control that put you there (native offered both routes too). Text
 * inputs are excluded for the same reason, and a handled Esc — a menu closing
 * itself — is left alone rather than doing two things at once.
 */
function useExitFocusOnEscape(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (swallowsEscape(event.target)) return;
      useLayoutStore.getState().exitFocus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function swallowsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // `data-terminal` is the xterm mount (terminal-view.tsx); the focused
  // textarea xterm listens on lives inside it.
  if (target.closest("[data-terminal]") !== null) return true;
  if (target.closest("input, textarea, select, [contenteditable]") !== null) return true;
  return false;
}
