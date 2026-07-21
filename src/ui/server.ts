import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LoopbackAuthority } from "./authority.js";
import { assertLoopbackRequest } from "./request.js";
import { routeUiRequest, type UiRouterOptions } from "./router.js";
import { createResponseNonce } from "./security/nonce.js";
import { applySecurityHeaders } from "./security/headers.js";

export interface UiServer {
  close(): Promise<void>;
  address(): AddressInfo | null;
}

type LegacyHandlerOptions = {
  authority: LoopbackAuthority;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
};

const hasRouter = (options: LegacyHandlerOptions | UiRouterOptions): options is UiRouterOptions =>
  "viewerSession" in options;

export async function createUiServer(options: LegacyHandlerOptions | UiRouterOptions): Promise<UiServer> {
  const server = createServer(async (req, res) => {
    applySecurityHeaders(res, { nonce: createResponseNonce() });
    try {
      assertLoopbackRequest(req, options.authority);
      if (hasRouter(options)) await routeUiRequest(req, res, options);
      else await options.handler(req, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 403;
        res.end("forbidden");
      } else {
        res.destroy();
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.authority.port, "127.0.0.1", resolve);
  });
  return {
    address: () => server.address() as AddressInfo | null,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
