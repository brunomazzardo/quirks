import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { LoopbackAuthority } from "./authority.js";
import { assertLoopbackRequest } from "./request.js";

export interface UiServer {
  close(): Promise<void>;
  address(): AddressInfo | null;
}

export type UiRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export async function createUiServer(options: {
  authority: LoopbackAuthority;
  handler: UiRequestHandler;
}): Promise<UiServer> {
  const server = createServer(async (req, res) => {
    try {
      assertLoopbackRequest(req, options.authority);
      await options.handler(req, res);
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
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
