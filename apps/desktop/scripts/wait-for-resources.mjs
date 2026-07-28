// Blocks until the files and TCP port a dev launch needs are actually there.
//
// Mirrored from t3code's apps/desktop/scripts/wait-for-resources.mjs, trimmed
// to a single TCP host list and a friendlier timeout message. Without it, a
// dev launch races the bundler and the web dev server and shows a blank window
// or ERR_CONNECTION_REFUSED instead of saying what is missing.

import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";

const DEFAULT_TCP_HOSTS = ["127.0.0.1", "localhost", "::1"];

async function fileExists(filePath) {
  try {
    await NodeFSP.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function tcpPortIsReady({ host, port, connectTimeoutMs }) {
  return new Promise((resolveReady) => {
    const socket = NodeNet.createConnection({ host, port });
    let settled = false;

    const finish = (ready) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolveReady(ready);
    };

    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.setTimeout(connectTimeoutMs);
  });
}

export async function waitForResources({
  baseDir,
  files = [],
  tcpHost,
  tcpPort,
  intervalMs = 100,
  timeoutMs = 120_000,
  connectTimeoutMs = 500,
  hint,
}) {
  const tcpHosts = tcpHost ? [tcpHost] : DEFAULT_TCP_HOSTS;
  const startedAt = Date.now();

  while (true) {
    const pendingFiles = [];
    for (const relativeFilePath of files) {
      if (!(await fileExists(NodePath.resolve(baseDir, relativeFilePath)))) {
        pendingFiles.push(relativeFilePath);
      }
    }

    let tcpReady = tcpPort === undefined;
    for (const host of tcpHosts) {
      if (tcpReady) {
        break;
      }
      tcpReady = await tcpPortIsReady({ host, port: tcpPort, connectTimeoutMs });
    }

    if (pendingFiles.length === 0 && tcpReady) {
      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      const pending = [
        ...(tcpReady ? [] : [`tcp:${tcpHost ?? "localhost"}:${tcpPort}`]),
        ...pendingFiles.map((filePath) => `file:${filePath}`),
      ];
      throw new Error(
        [
          `Timed out after ${timeoutMs}ms waiting for: ${pending.join(", ")}`,
          ...(hint ? [hint] : []),
        ].join("\n"),
      );
    }

    await NodeTimersPromises.setTimeout(intervalMs);
  }
}
