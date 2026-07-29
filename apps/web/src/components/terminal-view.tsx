// One live terminal: an xterm instance bound to one daemon pty (QK-WB-004).
//
// The data path is deliberately short. Terminal bytes arrive as BINARY
// WebSocket frames and go straight into `terminal.write(Uint8Array)` — xterm
// owns the UTF-8 decoding (statefully, so a character split across two frames
// still renders) and owns the scrollback. Nothing in between reduces, buffers,
// or re-encodes them. Control traffic — attach, resize, exit — rides text
// frames as JSON, so the two are told apart by frame type rather than by an
// envelope wrapped around every keystroke.
//
// SCROLLBACK, and who holds it. xterm keeps SCROLLBACK_LINES of history in the
// browser; that is the scrollback a user scrolls. The daemon's replay buffer is
// a different, smaller thing (256 KiB, apps/server/src/pty/Wire.ts): it exists
// only so a client that was not there — a page reload, a dev-server restart —
// can repaint. On every attach this component resets the terminal and paints
// the replay, which makes reconnect, first connect, and re-attach one code path
// with no chance of double-painting history. The cost is stated plainly: a
// reconnect truncates visible history to what the server still holds.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";

import {
  cssColorToHex,
  createSession,
  ensureSession,
  ptySocketUrl,
  type PtyServerMessage,
} from "~/lib/pty";
import { useTerminalStore } from "~/stores/terminals";

/** Generous on purpose — this is the gap the Native terminal could not close at
 *  all (it refused the `scrollback` attribute outright). */
const SCROLLBACK_LINES = 10_000;

/** Reconnect backoff. A daemon restart should be picked up quickly; a daemon
 *  that is simply gone should not be hammered. */
const RETRY_MIN_MS = 400;
const RETRY_MAX_MS = 5_000;

const encoder = new TextEncoder();

function fontStack(element: HTMLElement): string {
  const declared = getComputedStyle(element).getPropertyValue("--font-mono").trim();
  // The pane already renders in JetBrains Mono (src/index.css, loaded in
  // main.tsx); reading the token keeps the terminal on the same face as the
  // rest of the workbench instead of pinning a second copy of the stack here.
  return declared.length > 0 ? declared : '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';
}

/**
 * Background, foreground and cursor come from the app's own tokens so the
 * terminal is part of the pane rather than a black rectangle inside it.
 *
 * They are read as NAMED TOKENS (`--terminal-*`, declared in src/index.css)
 * rather than as this element's computed `background-color` and `color`. Those
 * were never the palette: the mount div paints no background of its own, so
 * its computed background-color is `rgba(0, 0, 0, 0)` — transparent — and
 * resolving that through a canvas yields #000000. The terminal was painting
 * itself black in both themes and only looked deliberate in the dark one.
 * Naming the tokens also means the geist pass reaches in here (QK-WB-006)
 * instead of stopping at the pane border: the cursor is the lamp.
 *
 * The ANSI palette stays fixed per light/dark — programs choose those colors
 * by number and expect them to look like themselves, so the theme has no
 * business restyling them.
 */
function themeFor(element: HTMLElement): ITheme {
  const dark = document.documentElement.classList.contains("dark");
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string): string =>
    cssColorToHex(style.getPropertyValue(name), fallback);

  const background = token("--terminal-background", dark ? "#09090b" : "#ffffff");
  const foreground = token("--terminal-foreground", dark ? "#e4e4e7" : "#27272a");
  const cursor = token("--terminal-cursor", dark ? "#e5a83d" : "#a86f12");
  const ansi = dark
    ? {
        black: "#3f3f46",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e4e4e7",
        brightBlack: "#71717a",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#fafafa",
      }
    : {
        black: "#27272a",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#ca8a04",
        blue: "#2563eb",
        magenta: "#9333ea",
        cyan: "#0891b2",
        white: "#52525b",
        brightBlack: "#71717a",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#eab308",
        brightBlue: "#3b82f6",
        brightMagenta: "#a855f7",
        brightCyan: "#06b6d4",
        brightWhite: "#18181b",
      };
  return {
    background,
    foreground,
    cursor,
    cursorAccent: background,
    // Kept as literal 8-digit hex rather than a token: a selection has to be
    // translucent to leave the text under it readable, and `cssColorToHex`
    // resolves through a canvas pixel, which cannot carry alpha back.
    selectionBackground: dark ? "#3f3f4680" : "#d4d4d880",
    ...ansi,
  };
}

/** `fit()` throws when the element has no layout — hidden, detached, or
 *  mid-transition. None of those are worth an error boundary. */
function fitSafely(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    /* no layout yet; the next observation will do it */
  }
}

export interface TerminalViewProps {
  readonly tabKey: string;
  /** Inactive views stay MOUNTED and laid out — see terminal-pane.tsx. */
  readonly active: boolean;
}

export function TerminalView({ tabKey, active }: TerminalViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      lineHeight: 1.15,
      scrollback: SCROLLBACK_LINES,
      fontFamily: fontStack(mount),
      theme: themeFor(mount),
      // Terminal output is the point of this pane; let it own the wheel.
      scrollOnUserInput: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(mount);
    fitSafely(fit);
    terminalRef.current = terminal;
    fitRef.current = fit;

    let socket: WebSocket | null = null;
    let disposed = false;
    let retryDelay = RETRY_MIN_MS;
    let retryTimer: number | undefined;
    let sessionId: string | null = null;
    let exited = false;

    const sendControl = (message: unknown): void => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const pushResize = (): void => {
      if (terminal.cols > 0 && terminal.rows > 0) {
        sendControl({ type: "resize", cols: terminal.cols, rows: terminal.rows });
      }
    };

    // Keystrokes go out as binary, byte for byte.
    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(encoder.encode(data));
    });

    // A pane that shares its row with Shape changes width whenever Shape is
    // hidden (QK-NAT-008), so geometry is observed rather than assumed. rAF
    // coalesces the burst a layout change produces into one fit.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const atBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
        fitSafely(fit);
        // Refitting reflows; a viewer who was reading the live tail should stay
        // on it rather than being left mid-history.
        if (atBottom) terminal.scrollToBottom();
        pushResize();
      });
    });
    observer.observe(mount);

    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = themeFor(mount);
      // xterm does not always repaint on a theme swap alone.
      terminal.refresh(0, terminal.rows - 1);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const scheduleRetry = (): void => {
      if (disposed || exited) return;
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };

    function onMessage(event: MessageEvent): void {
      if (typeof event.data !== "string") {
        // The hot path: raw terminal bytes, straight into the emulator.
        terminal.write(new Uint8Array(event.data as ArrayBuffer));
        return;
      }
      // A control frame the socket cannot parse is a frame this client does not
      // understand — not a reason to throw inside a listener and abandon the
      // rest of this message's handling. The daemon only sends well-formed
      // frames today, which is exactly why this stays latent until it isn't.
      let message: PtyServerMessage;
      try {
        message = JSON.parse(event.data) as PtyServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case "attached": {
          // Reset before the replay lands. Attaching is the only moment
          // history arrives, so this is what keeps a reconnect from painting
          // the same output twice.
          terminal.reset();
          retryDelay = RETRY_MIN_MS;
          useTerminalStore.getState().setStatus(tabKey, "live");
          // The server started at 80x24; tell it what this pane actually is.
          if (message.session.cols !== terminal.cols || message.session.rows !== terminal.rows) {
            pushResize();
          }
          return;
        }
        case "exit": {
          exited = true;
          useTerminalStore.getState().markExited(tabKey, message.exitCode);
          terminal.write(
            `\r\n\u001b[2m[process exited with code ${message.exitCode}]\u001b[0m\r\n`,
          );
          return;
        }
        case "error": {
          terminal.write(`\r\n\u001b[2m[${message.message}]\u001b[0m\r\n`);
          return;
        }
        default:
          return;
      }
    }

    function connect(): void {
      if (disposed || sessionId === null) return;
      const next = new WebSocket(ptySocketUrl(sessionId, window.location.origin));
      next.binaryType = "arraybuffer";
      socket = next;
      next.addEventListener("message", onMessage);
      next.addEventListener("open", () => {
        if (disposed) next.close();
      });
      next.addEventListener("close", () => {
        if (disposed || next !== socket) return;
        socket = null;
        if (exited) return;
        useTerminalStore
          .getState()
          .setStatus(tabKey, "reconnecting", "the daemon stopped answering");
        scheduleRetry();
      });
      // "error" always precedes "close"; the close handler owns the retry so
      // a socket that fails to open and one that drops behave identically.
      next.addEventListener("error", () => {});
    }

    const attachTo = (id: string): void => {
      if (disposed) return;
      sessionId = id;
      useTerminalStore.getState().bindSession(tabKey, id);
      connect();
    };

    // A tab that already carries a session id was ADOPTED: the daemon has held
    // that shell since before this page loaded, so attach to it rather than
    // create a second one and strand the first. That stranding is what made a
    // reload leak a shell, and sixteen reloads brick the pane.
    const adopted = useTerminalStore.getState().tabs.find((tab) => tab.key === tabKey)?.sessionId;
    if (adopted !== null && adopted !== undefined) {
      attachTo(adopted);
    } else {
      // Create at the size the pane already is, so the first prompt is drawn at
      // the right width rather than at 80x24 and then reflowed.
      ensureSession(tabKey, () =>
        createSession({
          cols: Math.max(terminal.cols, 1),
          rows: Math.max(terminal.rows, 1),
        }),
      )
        .then((session) => attachTo(session.id))
        .catch((error: unknown) => {
          if (disposed) return;
          useTerminalStore
            .getState()
            .setStatus(tabKey, "failed", error instanceof Error ? error.message : String(error));
        });
    }

    // A brand-new tab should be typeable without a click.
    if (active) window.requestAnimationFrame(() => terminal.focus());

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      // Detach only. The shell keeps running in the daemon — that is what makes
      // a page reload cheap and a re-attach possible.
      socket?.close();
      socket = null;
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [tabKey]);

  // Becoming visible can change nothing about layout, but it does mean the user
  // is about to type here.
  useEffect(() => {
    if (!active) return;
    const fit = fitRef.current;
    const terminal = terminalRef.current;
    if (fit === null || terminal === null) return;
    const frame = requestAnimationFrame(() => {
      fitSafely(fit);
      terminal.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div
      ref={mountRef}
      // Inactive terminals stay laid out rather than being unmounted or
      // display:none'd. Two reasons: xterm keeps its scrollback and its
      // alt-screen state, so switching tabs does not wipe what you were
      // reading; and a laid-out element has dimensions, so the fit addon and
      // the ResizeObserver keep working for every tab, not just the visible
      // one. That is what "at least two concurrent terminals with working
      // scrollback" costs in DOM terms.
      className={
        active
          ? "absolute inset-0 z-10 opacity-100"
          : "pointer-events-none absolute inset-0 z-0 opacity-0"
      }
      aria-hidden={!active}
      data-terminal={tabKey}
    />
  );
}
