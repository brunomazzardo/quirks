import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface LoopbackAuthority {
  host: "127.0.0.1";
  port: number;
  origin: string;
  baseUrl: string;
  hostHeader: string;
}

export async function createLoopbackAuthority(): Promise<LoopbackAuthority> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  const host = "127.0.0.1" as const;
  const origin = `http://${host}:${address.port}`;
  return {
    host,
    port: address.port,
    origin,
    baseUrl: origin,
    hostHeader: `${host}:${address.port}`,
  };
}
