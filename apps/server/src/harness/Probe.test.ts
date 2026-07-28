// QK-HARN-001 — availability probing.
// Ported from the bun-era test/harness-probe.test.ts (QK-MONO-005).
//
// This file exists mostly to pin the carried defect from docs/DECISIONS.md:114-115:
// v1's probe ended in `catch { return "unknown" }`, collapsing not-found, EACCES,
// non-zero exit, and a hung binary into one benign string. Each must stay its own
// answer, and none of them may be spelled "unknown".
//
// Every binary probed here is a throwaway shell script. No real agent CLI is
// executed by the suite, including on the `--probe` paths.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_EXECUTABLES,
  probeAuth,
  probeRunners,
  probeVersion,
  resolveExecutable,
} from "./Probe.ts";
import { runPlatform } from "../testing/Harness.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "quirks-probe-"));
}

/** Write a shell script and make it runnable. */
function script(body: string, mode = 0o755): string {
  const path = join(dir(), "fake-cli");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, mode);
  return path;
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("resolveExecutable distinguishes absent from denied", () => {
  it("a name nowhere on PATH is absent, and says where it looked", () => {
    const presence = resolveExecutable("quirks-definitely-not-installed-9f3a");
    expect(presence.state).toBe("absent");
    if (presence.state !== "absent") throw new Error("unreachable");
    expect(presence.reason).toContain("not on PATH");
  });

  it("an absolute path to nothing is absent", () => {
    expect(resolveExecutable(join(dir(), "nope")).state).toBe("absent");
  });

  it("an executable file is present, with the resolved path", () => {
    const path = script('echo "fake 1.2.3"');
    const presence = resolveExecutable(path);
    expect(presence.state).toBe("present");
    if (presence.state !== "present") throw new Error("unreachable");
    expect(presence.executable).toBe(path);
  });

  // THE carried defect: a permission failure is not evidence of absence.
  it.skipIf(isRoot)("a present-but-unexecutable file is denied, never absent", () => {
    const path = script('echo "hi"', 0o644);
    const presence = resolveExecutable(path);
    expect(presence.state).toBe("denied");
    if (presence.state !== "denied") throw new Error("unreachable");
    expect(presence.executable).toBe(path);
    expect(presence.reason).toContain("not executable");
    // Specifically: it must not have been reported as missing.
    expect(presence.state).not.toBe("absent");
  });
});

describe("probeVersion reports what actually happened", () => {
  it("a clean run yields the first line, bounded", async () => {
    const path = script('echo "fake-cli 9.9.9"\necho "second line ignored"');
    const probe = await runPlatform(probeVersion(path));
    expect(probe.state).toBe("ok");
    if (probe.state !== "ok") throw new Error("unreachable");
    expect(probe.version).toBe("fake-cli 9.9.9");
  });

  it("a long version string is truncated, not rejected", async () => {
    const path = script(`echo "${"v".repeat(200)}"`);
    const probe = await runPlatform(probeVersion(path));
    expect(probe.state).toBe("ok");
    if (probe.state !== "ok") throw new Error("unreachable");
    expect(probe.version.length).toBe(64);
  });

  it("a non-zero exit is an error carrying the code and stderr", async () => {
    const path = script('echo "not logged in" >&2\nexit 3');
    const probe = await runPlatform(probeVersion(path));
    expect(probe.state).toBe("error");
    if (probe.state !== "error") throw new Error("unreachable");
    expect(probe.exitCode).toBe(3);
    expect(probe.reason).toContain("not logged in");
  });

  it("exit 0 with no output is an error, not a silent success", async () => {
    const path = script("exit 0");
    const probe = await runPlatform(probeVersion(path));
    // Absence of a version is not a version. It must not become ok with "".
    expect(probe.state).toBe("error");
    if (probe.state !== "error") throw new Error("unreachable");
    expect(probe.reason).toContain("printed nothing");
  });

  it("a hanging binary times out and says so — not that it failed", async () => {
    const path = script("sleep 30");
    const probe = await runPlatform(probeVersion(path, 150));
    expect(probe.state).toBe("timeout");
    if (probe.state !== "timeout") throw new Error("unreachable");
    expect(probe.reason).toContain("150ms");
  }, 10_000);

  it("an unstartable binary is spawn-failed, with the errno", async () => {
    const probe = await runPlatform(probeVersion(join(dir(), "missing-binary")));
    expect(probe.state).toBe("spawn-failed");
    if (probe.state !== "spawn-failed") throw new Error("unreachable");
    expect(probe.code).toBe("ENOENT");
  });

  it("no outcome is ever the word unknown", async () => {
    const paths = [
      script('echo "ok 1.0"'),
      script("exit 1"),
      script("exit 0"),
      join(dir(), "missing"),
    ];
    for (const path of paths) {
      const probe = await runPlatform(probeVersion(path, 2_000));
      expect(probe.state).not.toBe("unknown");
      expect(JSON.stringify(probe)).not.toContain("unknown");
    }
  }, 15_000);
});

describe("probeRunners", () => {
  it("covers all three runners with their real executable names", async () => {
    const probes = await runPlatform(probeRunners());
    expect(probes.map((p) => p.runner)).toEqual(["claude", "codex", "cursor"]);
    expect(probes.find((p) => p.runner === "cursor")?.candidate).toBe("cursor-agent");
    expect(DEFAULT_EXECUTABLES.cursor).toBe("cursor-agent");
  });

  it("without --probe nothing is executed, and it says why", async () => {
    const path = script('echo "should not run"');
    const probes = await runPlatform(probeRunners({ executables: { claude: path } }));
    const claude = probes.find((p) => p.runner === "claude");
    expect(claude?.presence.state).toBe("present");
    expect(claude?.version.state).toBe("not-probed");
    if (claude?.version.state !== "not-probed") throw new Error("unreachable");
    expect(claude.version.reason).toContain("--probe");
  });

  it("with --probe a present harness reports its version", async () => {
    const path = script('echo "claude 2.1.217 (Claude Code)"');
    const probes = await runPlatform(
      probeRunners({ probeVersions: true, executables: { claude: path } }),
    );
    const claude = probes.find((p) => p.runner === "claude");
    expect(claude?.version.state).toBe("ok");
    if (claude?.version.state !== "ok") throw new Error("unreachable");
    expect(claude.version.version).toContain("2.1.217");
  });

  it("an absent harness is not probed, for a different reason than a denied one", async () => {
    const missing = join(dir(), "gone");
    const probes = await runPlatform(
      probeRunners({ probeVersions: true, executables: { claude: missing } }),
    );
    const claude = probes.find((p) => p.runner === "claude");
    expect(claude?.presence.state).toBe("absent");
    expect(claude?.version.state).toBe("not-probed");
    if (claude?.version.state !== "not-probed") throw new Error("unreachable");
    expect(claude.version.reason).toContain("nothing to run");
  });

  it.skipIf(isRoot)("a denied harness refuses to claim it works", async () => {
    const path = script('echo "hi"', 0o644);
    const probes = await runPlatform(
      probeRunners({ probeVersions: true, executables: { claude: path } }),
    );
    const claude = probes.find((p) => p.runner === "claude");
    expect(claude?.presence.state).toBe("denied");
    if (claude?.version.state !== "not-probed") throw new Error("unreachable");
    expect(claude.version.reason).toContain("refusing to claim it works");
  });
});

describe("probeAuth — authorization for free (QK-HARN-003)", () => {
  /** A fake CLI that answers its runner's real auth-status command. */
  function authBin(json: string, exit = 0): string {
    return script(`cat <<'JSON'\n${json}\nJSON\nexit ${exit}`);
  }

  it("claude: loggedIn true is authorized", async () => {
    const probe = await runPlatform(
      probeAuth("claude", authBin('{"loggedIn":true,"authMethod":"claude.ai"}')),
    );
    expect(probe.state).toBe("authorized");
  });

  it("claude: loggedIn false is unauthorized — the case that used to read unproven", async () => {
    const probe = await runPlatform(probeAuth("claude", authBin('{"loggedIn":false}')));
    expect(probe.state).toBe("unauthorized");
    if (probe.state !== "unauthorized") throw new Error("unreachable");
    expect(probe.detail).toContain("not logged in");
  });

  it("cursor: isAuthenticated drives the answer", async () => {
    expect(
      (
        await runPlatform(
          probeAuth("cursor", authBin('{"status":"authenticated","isAuthenticated":true}')),
        )
      ).state,
    ).toBe("authorized");
    expect(
      (await runPlatform(probeAuth("cursor", authBin('{"isAuthenticated":false}')))).state,
    ).toBe("unauthorized");
  });

  it("codex: reads the auth-category check under its DOTTED key", async () => {
    // The real shape, captured from `codex doctor --json` on 2026-07-28: `checks`
    // is a flat map whose keys are dotted ids. An earlier version of this test
    // invented a nested {auth:{credentials:…}} and passed while the real CLI
    // reported "unknown" — the parser now matches on `category`.
    const real = (status: string) =>
      JSON.stringify({
        schemaVersion: 1,
        checks: {
          "app_server.status": { id: "app_server.status", category: "app_server", status: "ok" },
          "auth.credentials": { id: "auth.credentials", category: "auth", status },
        },
      });
    expect((await runPlatform(probeAuth("codex", authBin(real("ok"))))).state).toBe("authorized");
    const probe = await runPlatform(probeAuth("codex", authBin(real("error"))));
    expect(probe.state).toBe("unauthorized");
    if (probe.state !== "unauthorized") throw new Error("unreachable");
    expect(probe.detail).toContain("error");
  });

  it("codex: a renamed key still works, because we match on category", async () => {
    const renamed = JSON.stringify({
      schemaVersion: 2,
      checks: { "auth.something_else": { category: "auth", status: "ok" } },
    });
    expect((await runPlatform(probeAuth("codex", authBin(renamed)))).state).toBe("authorized");
  });

  it("non-JSON output is unknown, NOT unauthorized", async () => {
    // An older CLI without the subcommand prints usage text. Reading that as
    // "logged out" would take a working harness out of service on no evidence.
    const probe = await runPlatform(
      probeAuth("claude", script("echo 'error: unknown command'; exit 1")),
    );
    expect(probe.state).toBe("unknown");
  });

  it("JSON without the field we need is unknown", async () => {
    expect((await runPlatform(probeAuth("claude", authBin('{"somethingElse":true}')))).state).toBe(
      "unknown",
    );
    expect(
      (await runPlatform(probeAuth("codex", authBin('{"schemaVersion":1,"checks":{}}')))).state,
    ).toBe("unknown");
    // A check with no auth category at all is also unknown, not unauthorized.
    expect(
      (
        await runPlatform(
          probeAuth(
            "codex",
            authBin('{"checks":{"git.environment":{"category":"git","status":"ok"}}}'),
          ),
        )
      ).state,
    ).toBe("unknown");
  });

  it("a hanging status command is unknown, not a verdict", async () => {
    const probe = await runPlatform(probeAuth("claude", script("exec sleep 30"), 200));
    expect(probe.state).toBe("unknown");
    if (probe.state !== "unknown") throw new Error("unreachable");
    expect(probe.detail).toContain("200ms");
  }, 10_000);

  it("an unstartable binary is unknown", async () => {
    expect((await runPlatform(probeAuth("codex", join(dir(), "missing")))).state).toBe("unknown");
  });

  it("probeRunners fills auth alongside version when probing", async () => {
    const probes = await runPlatform(
      probeRunners({ probeVersions: true, executables: { claude: authBin('{"loggedIn":true}') } }),
    );
    // The same fake answers both calls; what matters is auth was populated.
    expect(probes.find((p) => p.runner === "claude")?.auth.state).toBe("authorized");
  });

  it("without --probe, auth is not-probed for every runner", async () => {
    for (const probe of await runPlatform(probeRunners())) {
      expect(probe.auth.state).toBe("not-probed");
    }
  });
});
