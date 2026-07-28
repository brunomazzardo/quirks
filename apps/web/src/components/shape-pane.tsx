import { ExternalLink, PanelRightClose, RefreshCw, Shapes } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { serviceBaseUrl } from "~/lib/service";
import { cn } from "~/lib/utils";
import { useLayoutStore } from "~/stores/layout";

const TASK_ID = "QK-WB-005";

type ConnStatus = "checking" | "up" | "down";

/**
 * Is anything answering at `url`? An ordinary status check, now that it can be.
 *
 * It used to need `mode: "no-cors"`: the companion routes set no CORS headers
 * (loopback-only tool, see src/service/app.ts), so a cross-origin `fetch` in
 * "cors" mode rejected whether the service was down OR merely not offering an
 * Access-Control-Allow-Origin, and an opaque response was the only up/down
 * signal available. QK-WB-003 made the base URL same-origin (lib/service.ts)
 * and put a dev proxy in front of `/shape`, so the response is readable and
 * `response.ok` is the honest answer. Reading the status matters, not just the
 * absence of a throw: a stopped daemon now arrives as a proxy 5xx rather than
 * a rejected fetch.
 */
function useServiceProbe(url: string): { status: ConnStatus; retry: () => void; token: number } {
  const [status, setStatus] = useState<ConnStatus>("checking");
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("checking");
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!cancelled) setStatus(response.ok ? "up" : "down");
      })
      .catch(() => {
        if (!cancelled) setStatus("down");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, token]);

  const retry = useCallback(() => setToken((n) => n + 1), []);
  return { status, retry, token };
}

type LiveState = "idle" | "live" | "offline";

/**
 * Liveness dot from GET /shape/events-stream. This used to be best-effort for
 * the same reason as the probe — a cross-origin EventSource against a
 * CORS-less endpoint sits in "offline" even while the service is healthy — and
 * became a real signal when the stream went same-origin through the dev proxy
 * (QK-WB-003). Still secondary: the primary up/down read is `useServiceProbe`,
 * and this never blocks it.
 */
function useShapeLiveness(url: string, enabled: boolean): LiveState {
  const [state, setState] = useState<LiveState>("idle");

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setState("idle");
      return;
    }
    let source: EventSource;
    try {
      source = new EventSource(url);
    } catch {
      setState("offline");
      return;
    }
    const handleOpen = () => setState("live");
    const handleError = () => setState("offline");
    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);
    return () => {
      source.removeEventListener("open", handleOpen);
      source.removeEventListener("error", handleError);
      source.close();
    };
  }, [url, enabled]);

  return state;
}

/**
 * Shape pane (QK-WB-005): the companion screens surface from QK-NAT-003,
 * with the fully-hideable toolbar affordance from QK-NAT-008. Hiding it
 * hands its space to whatever sibling shares its flex row — see
 * routes/index.tsx, which nests Terminal + Shape together so Terminal is the
 * one that grows, matching the native `rightSplit` behavior.
 *
 * Known limitation: GET /shape/ responds with `X-Frame-Options: DENY`
 * (src/service/app.ts) — a header the native preview panel never had to
 * contend with, since it was not a browser frame. That is unconditional and
 * out of this task's reach (server routes live outside apps/web/src), so a
 * browser will refuse to paint the iframe's contents even while `status` is
 * "up". The same-origin dev proxy added by QK-WB-003 does NOT fix this: it
 * forwards the header verbatim, and DENY refuses framing from any origin,
 * including its own. Relaxing it is the server lane's task; until then the
 * "open in new tab" link is the working path.
 */
export function ShapePane() {
  const shapeHidden = useLayoutStore((state) => state.shapeHidden);
  const toggleShape = useLayoutStore((state) => state.toggleShape);

  const base = serviceBaseUrl();
  const shapeUrl = `${base}/shape/`;
  const eventsUrl = `${base}/shape/events-stream`;

  const { status, retry, token } = useServiceProbe(shapeUrl);
  const live = useShapeLiveness(eventsUrl, !shapeHidden);

  if (shapeHidden) {
    return (
      <button
        type="button"
        onClick={toggleShape}
        aria-label="Show Shape pane"
        title="Show Shape"
        className="flex w-9 shrink-0 flex-col items-center gap-2 rounded-lg border bg-card py-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Shapes className="size-3.5" />
        <span className="[writing-mode:vertical-rl] rotate-180 font-mono text-[10px] tracking-tight">
          Shape
        </span>
      </button>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card text-card-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
        <Shapes />
        <h2 className="text-xs font-medium tracking-tight">Shape</h2>
        <span
          aria-hidden="true"
          title={`companion stream: ${live}`}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            live === "live" && "bg-emerald-500",
            live === "offline" && "bg-destructive/50",
            live === "idle" && "bg-muted-foreground/30",
          )}
        />
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{TASK_ID}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={toggleShape}
          aria-label="Hide Shape pane"
          title="Hide Shape"
        >
          <PanelRightClose />
        </Button>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {status === "up" ? (
          <iframe
            key={`${shapeUrl}#${token}`}
            src={shapeUrl}
            title="Shape companion"
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="font-mono text-xs text-muted-foreground">
              {status === "checking" ? "connecting…" : "companion not reachable"}
            </p>
            <p className="max-w-full truncate font-mono text-[10px] text-muted-foreground/70">
              {shapeUrl}
            </p>
            <Button
              size="xs"
              variant="outline"
              onClick={retry}
              disabled={status === "checking"}
              className="mt-1"
            >
              <RefreshCw />
              Retry
            </Button>
          </div>
        )}
        <a
          href={shapeUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md border bg-popover/90 px-2 py-1 font-mono text-[10px] text-muted-foreground shadow-xs hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          open in new tab
        </a>
      </div>
    </section>
  );
}
