// Thin client behind start-server.sh: ensure the quirks daemon, open one
// shape session for this repo, optionally open the browser. No second process.
//
// Lives with the skill (QK-MONO-007): the daemon it ensures is the Effect
// server in apps/server; run under node (>=24.13, type stripping).

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function resolveRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

function portForRoot(root: string): number {
  if (process.env.QUIRKS_PORT) {
    const p = Number.parseInt(process.env.QUIRKS_PORT, 10);
    if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
  }
  const h = createHash("sha256").update(root).digest();
  return 45000 + (h.readUInt32BE(0) % 15000);
}

// scripts -> shape -> skills -> .claude -> repo root, then the server bin.
const BIN = fileURLToPath(new URL("../../../../apps/server/src/bin.ts", import.meta.url));

async function health(base: string): Promise<{ root: string } | null> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return null;
    return (await res.json()) as { root: string };
  } catch {
    return null;
  }
}

async function ensureDaemon(root: string, port: number): Promise<string> {
  const base = `http://127.0.0.1:${port}`;
  const first = await health(base);
  if (first) {
    if (first.root !== root) {
      throw new Error(`port ${port} is serving ${first.root}, not ${root}`);
    }
    return base;
  }
  const child = spawn(process.execPath, [BIN, "serve"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, QUIRKS_PORT: String(port) },
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const h = await health(base);
    if (h) {
      if (h.root !== root) throw new Error(`port ${port} is serving ${h.root}, not ${root}`);
      return base;
    }
  }
  throw new Error(`quirks daemon unreachable at 127.0.0.1:${port}`);
}

function openBrowser(url: string): void {
  if (process.env.SHAPE_OPEN_CMD) {
    try {
      execFileSync("sh", ["-c", `${process.env.SHAPE_OPEN_CMD} ${JSON.stringify(url)}`], {
        stdio: "ignore",
      });
    } catch {
      /* best effort */
    }
    return;
  }
  const platform = process.platform;
  try {
    if (platform === "darwin") execFileSync("open", [url], { stdio: "ignore" });
    else if (platform === "win32") execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    else execFileSync("xdg-open", [url], { stdio: "ignore" });
  } catch {
    /* headless */
  }
}

function parseArgs(argv: string[]): { projectDir: string; open: boolean } {
  let projectDir = process.cwd();
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--project-dir") {
      projectDir = argv[++i] ?? projectDir;
    } else if (a === "--open") {
      open = true;
    } else if (a === "--host" || a === "--url-host" || a === "--idle-timeout-minutes") {
      i++; // accepted no-ops for old skill muscle memory
    } else if (
      a === "--foreground" ||
      a === "--background" ||
      a === "--no-daemon" ||
      a === "--daemon"
    ) {
      // no-ops — the quirks daemon owns the process
    } else if (a.startsWith("-")) {
      console.log(JSON.stringify({ error: `Unknown argument: ${a}` }));
      process.exit(1);
    }
  }
  return { projectDir, open };
}

async function main(): Promise<void> {
  const { projectDir, open } = parseArgs(process.argv.slice(2));
  const root = resolveRoot(projectDir);
  const port = portForRoot(root);
  const base = await ensureDaemon(root, port);
  const res = await fetch(`${base}/v1/shape/ensure`, { method: "POST" });
  if (!res.ok) {
    console.log(JSON.stringify({ error: `ensure failed: ${res.status} ${await res.text()}` }));
    process.exit(1);
  }
  const info = (await res.json()) as {
    url: string;
    screen_dir: string;
    state_dir: string;
    session_dir: string;
  };
  if (open || process.env.SHAPE_OPEN) openBrowser(info.url);
  console.log(
    JSON.stringify({
      url: info.url,
      screen_dir: info.screen_dir,
      state_dir: info.state_dir,
      session_dir: info.session_dir,
    }),
  );
}

main().catch((err) => {
  console.log(JSON.stringify({ error: (err as Error).message }));
  process.exit(1);
});
