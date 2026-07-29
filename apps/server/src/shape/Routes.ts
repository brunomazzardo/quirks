// The shape companion's routes (QK-COMP-003) — open on loopback; auth is
// QK-SRV-003, and cross-origin writes are refused by `originGuard` (http/Wire.ts).
//
// These lived in http/Routes.ts, 185 lines of one domain inside the file that
// also holds goals, tasks and runs — while pty, the other domain with its own
// surface, owned pty/Routes.ts. Same pattern, applied to one domain and not the
// other. http/Routes.ts gains a route with every verb, so it was the file most
// likely to reach the 1k-line wall first; moving these cuts it by a third and
// puts the shape routes beside the session they drive.

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { Store } from "../store/Store.ts";
import { body, str } from "../http/Body.ts";
import { json, jsonError, pathParam, respond } from "../http/Wire.ts";
import {
  contentFilePath,
  endShapeSession,
  ensureShapeSession,
  fontPath,
  hubFor,
  notifyScreenChange,
  pushScreen,
  readEvents,
  recordEvent,
  renderShapePage,
  shapeContentSecurityPolicy,
  startContentWatch,
  stopContentWatch,
} from "./Session.ts";

const hostHeader = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return request.headers["host"] ?? "127.0.0.1";
});

export const routes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/v1/shape/ensure",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const url = `http://${yield* hostHeader}/shape/`;
        const paths = ensureShapeSession(store.root, url);
        startContentWatch(store.root);
        return json({
          url,
          screen_dir: paths.contentDir,
          state_dir: paths.stateDir,
          session_dir: paths.sessionDir,
        });
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/shape/end",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        stopContentWatch(store.root);
        endShapeSession(store.root);
        return json({ status: "ended" });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/shape/events",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        return json({ events: readEvents(store.root) });
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/shape/screens",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const input = yield* body;
        const name = str(input, "name");
        const html = str(input, "html");
        if (!name || html === undefined) {
          return jsonError("name and html are required", 400);
        }
        ensureShapeSession(store.root, `http://${yield* hostHeader}/shape/`);
        startContentWatch(store.root);
        const result = pushScreen(store.root, name, html);
        notifyScreenChange(store.root);
        return json(result, 201);
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        // Fresh per response: a nonce a screen could predict is not a nonce.
        const nonce = randomBytes(16).toString("base64");
        return HttpServerResponse.text(renderShapePage(store.root, nonce), {
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: {
            "Cache-Control": "no-store",
            // A screen is served verbatim when it is a full document, on the
            // very origin that serves /v1 — so the page states what it is
            // allowed to do rather than trusting every screen ever written.
            "Content-Security-Policy": shapeContentSecurityPolicy(nonce),
            // SAMEORIGIN, not DENY (QK-WB-009). DENY was ported verbatim from
            // the bun era, where the only viewer was the native preview panel —
            // not a browser frame, so nothing ever obeyed it. The workbench's
            // Shape pane IS a browser iframe, and DENY refuses framing from
            // every origin including its own, so the pane stayed blank while the
            // probe said "up". Now that the service serves the workbench itself
            // (src/http/Renderer.ts), the page and this companion share one
            // loopback origin and SAMEORIGIN is exactly the right latitude: the
            // pane paints, and a page from anywhere else still cannot frame it.
            "X-Frame-Options": "SAMEORIGIN",
            "Referrer-Policy": "no-referrer",
          },
        });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/events-stream",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const hub = hubFor(store.root);
        return HttpServerResponse.stream(
          Stream.fromReadableStream<Uint8Array, unknown>({
            evaluate: () => hub.subscribe(),
            onError: (error) => error,
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
              Connection: "keep-alive",
            },
          },
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/shape/event",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const text = yield* request.text;
        if (text.length > 64 * 1024) return HttpServerResponse.empty({ status: 413 });
        let event: unknown;
        try {
          event = JSON.parse(text);
        } catch {
          return jsonError("invalid JSON", 400);
        }
        if (
          event !== null &&
          typeof event === "object" &&
          "choice" in event &&
          (event as { choice: unknown }).choice
        ) {
          recordEvent(store.root, event);
        }
        return HttpServerResponse.empty({ status: 204 });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/fonts/:name",
    respond(
      Effect.gen(function* () {
        const fp = fontPath(yield* pathParam("name"));
        if (!fp) return HttpServerResponse.text("Not found", { status: 404 });
        return HttpServerResponse.uint8Array(readFileSync(fp), {
          contentType: "font/woff2",
          headers: { "Cache-Control": "private, max-age=86400" },
        });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/files/:name",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const fp = contentFilePath(store.root, yield* pathParam("name"));
        if (!fp) return HttpServerResponse.text("Not found", { status: 404 });
        const contentType = fp.toLowerCase().endsWith(".html")
          ? "text/html; charset=utf-8"
          : "application/octet-stream";
        return HttpServerResponse.uint8Array(readFileSync(fp), {
          contentType,
          headers: { "Cache-Control": "no-store" },
        });
      }),
    ),
  ),
);
