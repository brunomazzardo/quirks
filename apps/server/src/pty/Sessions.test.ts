// pty session lifecycle (QK-WB-004) — and specifically the two things the
// Native SDK could not do: run more than one terminal at a time, and keep any
// history at all (docs/upstream/native-terminal-gap/).
//
// RULE FOR THIS FILE: never spawn an interactive shell. Every session here is
// `/bin/sh` with an explicit `-c` script that either ends on its own or ends
// when its stdin closes, and every wait has a deadline. A test that hangs a pty
// hangs the suite, and `sh -i` waiting for a prompt is the classic way to do it.
// Passing an explicit `shell` also disables the default candidate cascade, so a
// script can never silently become somebody's login zsh.

import { execFileSync } from "node:child_process";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { layerAt } from "../store/Store.ts";
import { tempRoot } from "../testing/Harness.ts";
import { make, type PtyListener, type PtySessionsShape } from "./Sessions.ts";
import { MAX_SESSIONS } from "./Wire.ts";

const decoder = new TextDecoder();

/** A registry over a temp root, torn down when `body` returns — closing the
 *  scope is exactly what the daemon does at shutdown, so every test here also
 *  exercises the finalizer. */
const withSessions = <A>(
  body: (sessions: PtySessionsShape, root: string) => Promise<A>,
  options: { readonly replayLimit?: number; readonly graceMs?: number } = {},
): Promise<A> => {
  const root = tempRoot("quirks-pty-");
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sessions = yield* make(options);
        return yield* Effect.promise(() => body(sessions, root));
      }),
    ).pipe(Effect.provide(layerAt(root))),
  );
};

/** Collect everything a session emits, for assertions about ordering. */
function collector() {
  let seen = "";
  let exit: { exitCode: number; signal: number } | null = null;
  const listener: PtyListener = {
    onData: (chunk) => {
      seen += decoder.decode(chunk);
    },
    onExit: (event) => {
      exit = event;
    },
  };
  return {
    listener,
    get text(): string {
      return seen;
    },
    get exit(): { exitCode: number; signal: number } | null {
      return exit;
    },
  };
}

/** Poll until `predicate` holds, or fail loudly with what was actually seen —
 *  a bare timeout tells you nothing about why. */
async function waitFor(
  predicate: () => boolean,
  describeState: () => string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out after ${timeoutMs}ms; state: ${describeState()}`);
}

/** Alive means "a process is there and it is not a zombie". `kill(pid, 0)`
 *  alone answers true for an unreaped corpse, which would make the no-orphan
 *  assertion pass for the wrong reason. */
function alive(pid: number): boolean {
  try {
    const stat = execFileSync("ps", ["-p", String(pid), "-o", "stat="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return stat.length > 0 && !stat.startsWith("Z");
  } catch {
    return false;
  }
}

function childrenOf(pid: number): number[] {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

/** A shell script session. Explicit shell + args, always. */
const script = (sessions: PtySessionsShape, source: string) =>
  sessions.create({ shell: "/bin/sh", args: ["-c", source] });

/** Poll until the short-lived shell actually finished (and, when asked, left
 *  bytes in the replay). A fixed 300ms sleep raced real /bin/sh on loaded
 *  hosts — a 1-in-7 flake caught in QK-WB-009 review. Loud on timeout. */
const settled = async (
  sessions: PtySessionsShape,
  id: string,
  opts: { replay?: boolean } = {},
): Promise<void> => {
  const deadline = Date.now() + 5000;
  for (;;) {
    const info = await Effect.runPromise(sessions.get(id));
    if (info.exited && (!opts.replay || info.replayBytes > 0)) return;
    if (Date.now() > deadline) {
      throw new Error(`session ${id} never settled: ${JSON.stringify(info)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("a session's life", () => {
  it("starts, reports itself, produces output, and exits with its code", async () => {
    await withSessions(async (sessions) => {
      const sink = collector();
      const info = await Effect.runPromise(script(sessions, "echo hello-quirks; exit 3"));

      expect(info.pid).toBeGreaterThan(0);
      expect(info.exited).toBe(false);
      expect(info.exitCode).toBeNull();
      expect(info.cols).toBe(80);
      expect(info.rows).toBe(24);

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* sessions.attach(info.id, sink.listener);
            yield* Effect.promise(() =>
              waitFor(
                () => sink.exit !== null,
                () => JSON.stringify(sink.text),
              ),
            );
          }),
        ),
      );

      expect(sink.text).toContain("hello-quirks");
      expect(sink.exit?.exitCode).toBe(3);

      const after = await Effect.runPromise(sessions.get(info.id));
      expect(after.exited).toBe(true);
      expect(after.exitCode).toBe(3);
      expect(after.exitedAt).not.toBeNull();
    });
  });

  it("defaults the cwd to the store root — a terminal opens where the ledger is", async () => {
    await withSessions(async (sessions, root) => {
      const info = await Effect.runPromise(script(sessions, "pwd"));
      expect(info.cwd).toBe(root);
    });
  });

  it("lists what it has, and 404s what it does not", async () => {
    await withSessions(async (sessions) => {
      expect(await Effect.runPromise(sessions.list)).toEqual([]);
      const info = await Effect.runPromise(script(sessions, "sleep 30"));
      const listed = await Effect.runPromise(sessions.list);
      expect(listed.map((s) => s.id)).toEqual([info.id]);

      const error = await Effect.runPromise(Effect.flip(sessions.get("pty_nope")));
      expect(error._tag).toBe("NotFoundError");
    });
  });

  it("refuses geometry a terminal cannot have, rather than passing it to ioctl", async () => {
    await withSessions(async (sessions) => {
      for (const bad of [
        { cols: 0, rows: 24 },
        { cols: 80, rows: 0 },
        { cols: 5000, rows: 24 },
      ]) {
        const error = await Effect.runPromise(
          Effect.flip(sessions.create({ shell: "/bin/sh", args: ["-c", "true"], ...bad })),
        );
        expect(error._tag).toBe("ValidationError");
      }
    });
  });

  it("refuses a cwd that is not a directory", async () => {
    await withSessions(async (sessions) => {
      const error = await Effect.runPromise(
        Effect.flip(
          sessions.create({ shell: "/bin/sh", args: ["-c", "true"], cwd: "/nope/not/here" }),
        ),
      );
      expect(error._tag).toBe("ValidationError");
      expect(error.message).toContain("not a directory");
    });
  });

  it("caps runaway session creation rather than forking without limit", async () => {
    await withSessions(async (sessions) => {
      for (let i = 0; i < MAX_SESSIONS; i += 1) {
        await Effect.runPromise(script(sessions, "sleep 30"));
      }
      const error = await Effect.runPromise(Effect.flip(script(sessions, "sleep 30")));
      expect(error._tag).toBe("ConflictError");
    });
  });
});

describe("two at once — the gap QK-WB-004 exists to close", () => {
  it("runs two concurrent sessions with interleaved I/O and no crosstalk", async () => {
    await withSessions(async (sessions) => {
      // `stty -echo` keeps the pty from echoing input back, so what each
      // collector sees is the shell's answer and nothing else.
      const loop = (tag: string) =>
        script(sessions, `stty -echo; while read line; do echo "${tag}:$line"; done`);

      const a = await Effect.runPromise(loop("A"));
      const b = await Effect.runPromise(loop("B"));
      expect(a.id).not.toBe(b.id);
      expect(a.pid).not.toBe(b.pid);

      const sinkA = collector();
      const sinkB = collector();

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* sessions.attach(a.id, sinkA.listener);
            yield* sessions.attach(b.id, sinkB.listener);

            // Interleaved on purpose: alternate writes to the two shells and
            // then require that each answered only its own.
            for (let i = 0; i < 5; i += 1) {
              yield* sessions.write(a.id, `alpha${i}\n`);
              yield* sessions.write(b.id, `beta${i}\n`);
            }

            yield* Effect.promise(() =>
              waitFor(
                () => sinkA.text.includes("A:alpha4") && sinkB.text.includes("B:beta4"),
                () => `A=${JSON.stringify(sinkA.text)} B=${JSON.stringify(sinkB.text)}`,
              ),
            );
          }),
        ),
      );

      for (let i = 0; i < 5; i += 1) {
        expect(sinkA.text).toContain(`A:alpha${i}`);
        expect(sinkB.text).toContain(`B:beta${i}`);
      }
      // The whole point: neither stream carries the other's traffic.
      expect(sinkA.text).not.toContain("beta");
      expect(sinkA.text).not.toContain("B:");
      expect(sinkB.text).not.toContain("alpha");
      expect(sinkB.text).not.toContain("A:");

      expect((await Effect.runPromise(sessions.list)).filter((s) => !s.exited)).toHaveLength(2);
    });
  });

  it("keeps a third and a fourth apart too — 'two' was never the ceiling", async () => {
    await withSessions(async (sessions) => {
      const infos = await Promise.all(
        ["one", "two", "three", "four"].map((tag) =>
          Effect.runPromise(
            script(sessions, `stty -echo; while read l; do echo "${tag}=$l"; done`),
          ),
        ),
      );
      const sinks = infos.map(() => collector());

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            for (const [index, info] of infos.entries()) {
              const sink = sinks[index];
              if (sink !== undefined) yield* sessions.attach(info.id, sink.listener);
            }
            for (const info of infos) yield* sessions.write(info.id, "ping\n");
            yield* Effect.promise(() =>
              waitFor(
                () => sinks.every((sink) => sink.text.includes("=ping")),
                () => sinks.map((s) => JSON.stringify(s.text)).join(" | "),
              ),
            );
          }),
        ),
      );

      expect(sinks[0]?.text).toContain("one=ping");
      expect(sinks[1]?.text).toContain("two=ping");
      expect(sinks[2]?.text).toContain("three=ping");
      expect(sinks[3]?.text).toContain("four=ping");
    });
  });
});

describe("the replay buffer", () => {
  it("hands a late attacher the history it missed", async () => {
    await withSessions(async (sessions) => {
      const info = await Effect.runPromise(script(sessions, "echo before-anyone-was-watching"));
      // Nobody is attached while this runs — which is exactly the case the
      // Native terminal could not survive.
      await settled(sessions, info.id, { replay: true });

      const replayed = await Effect.runPromise(
        Effect.scoped(
          Effect.map(
            sessions.attach(info.id, { onData: () => {}, onExit: () => {} }),
            (attachment) => decoder.decode(attachment.replay),
          ),
        ),
      );
      expect(replayed).toContain("before-anyone-was-watching");
    });
  });

  it("stops at its bound, keeps the newest, and admits what it dropped", async () => {
    const limit = 2048;
    await withSessions(
      async (sessions) => {
        const sink = collector();
        // ~200 lines of ~45 bytes: several times the bound, so the ring must
        // have discarded from the front by the time the shell exits.
        const info = await Effect.runPromise(
          script(
            sessions,
            'i=0; while [ $i -lt 200 ]; do echo "line-$i-padpadpadpadpadpadpadpadpad"; i=$((i+1)); done',
          ),
        );

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              yield* sessions.attach(info.id, sink.listener);
              yield* Effect.promise(() =>
                waitFor(
                  () => sink.exit !== null,
                  () => `${sink.text.length} bytes seen`,
                ),
              );
            }),
          ),
        );

        const after = await Effect.runPromise(sessions.get(info.id));
        expect(after.replayBytes).toBeLessThanOrEqual(limit);
        expect(after.droppedBytes).toBeGreaterThan(0);

        const replayed = await Effect.runPromise(
          Effect.scoped(
            Effect.map(
              sessions.attach(info.id, { onData: () => {}, onExit: () => {} }),
              (attachment) => decoder.decode(attachment.replay),
            ),
          ),
        );
        // The tail survives; the head is what went.
        expect(replayed).toContain("line-199");
        expect(replayed).not.toContain("line-0-");
        // A live listener still saw everything — the bound is on what is KEPT
        // for a future attacher, not on what is delivered.
        expect(sink.text).toContain("line-0-");
        expect(sink.text).toContain("line-199");
      },
      { replayLimit: limit },
    );
  });
});

describe("resize", () => {
  it("reaches the shell — the pty reports the new geometry, not just the record", async () => {
    await withSessions(async (sessions) => {
      const sink = collector();
      const info = await Effect.runPromise(
        script(sessions, "stty -echo; while read l; do stty size; done"),
      );
      expect(info.cols).toBe(80);

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* sessions.attach(info.id, sink.listener);
            const resized = yield* sessions.resize(info.id, 132, 43);
            expect(resized.cols).toBe(132);
            expect(resized.rows).toBe(43);
            yield* sessions.write(info.id, "now\n");
            // `stty size` prints "rows cols" — the shell's own view of the
            // terminal, which is the only proof the ioctl landed.
            yield* Effect.promise(() =>
              waitFor(
                () => sink.text.includes("43 132"),
                () => JSON.stringify(sink.text),
              ),
            );
          }),
        ),
      );

      expect(sink.text).toContain("43 132");
      expect((await Effect.runPromise(sessions.get(info.id))).cols).toBe(132);
    });
  });

  it("refuses nonsense geometry and leaves the session as it was", async () => {
    await withSessions(async (sessions) => {
      const info = await Effect.runPromise(script(sessions, "sleep 30"));
      const error = await Effect.runPromise(Effect.flip(sessions.resize(info.id, 0, 24)));
      expect(error._tag).toBe("ValidationError");
      expect((await Effect.runPromise(sessions.get(info.id))).cols).toBe(80);
    });
  });

  it("a resize racing the shell's exit is not a failure the caller can act on", async () => {
    await withSessions(async (sessions) => {
      const info = await Effect.runPromise(script(sessions, "exit 0"));
      await settled(sessions, info.id);
      const resized = await Effect.runPromise(sessions.resize(info.id, 100, 40));
      expect(resized.cols).toBe(100);
    });
  });
});

describe("nothing outlives the daemon", () => {
  it("closing the layer scope kills the shell AND its children", async () => {
    // `sleep 30 & wait` forces a real grandchild: sh stays alive holding a
    // background sleep, so killing only the leader would leave the sleep
    // behind. Job control is off in a non-interactive shell, so both share the
    // session's process group — which is what `kill(-pid)` reaches.
    let leader = 0;
    let descendants: number[] = [];

    await withSessions(async (sessions) => {
      const info = await Effect.runPromise(script(sessions, "sleep 30 & wait"));
      leader = info.pid;
      await waitFor(
        () => childrenOf(leader).length > 0,
        () => `no children of ${leader} yet`,
        10_000,
      );
      descendants = childrenOf(leader);
      expect(descendants.length).toBeGreaterThan(0);
      expect(alive(leader)).toBe(true);
      for (const pid of descendants) expect(alive(pid)).toBe(true);
    });

    // The scope has closed — the same event `POST /shutdown` causes.
    await waitFor(
      () => !alive(leader) && descendants.every((pid) => !alive(pid)),
      () => `leader ${leader} alive=${alive(leader)}, descendants ${descendants.join(",")}`,
    );
    expect(alive(leader)).toBe(false);
    for (const pid of descendants) expect(alive(pid)).toBe(false);
  });

  it("killAll stops every session at once and empties the registry", async () => {
    const pids: number[] = [];
    await withSessions(async (sessions) => {
      for (let i = 0; i < 3; i += 1) {
        pids.push((await Effect.runPromise(script(sessions, "sleep 30"))).pid);
      }
      expect(await Effect.runPromise(sessions.list)).toHaveLength(3);
      await Effect.runPromise(sessions.killAll);
      expect(await Effect.runPromise(sessions.list)).toEqual([]);
      await waitFor(
        () => pids.every((pid) => !alive(pid)),
        () => pids.map((pid) => `${pid}:${alive(pid)}`).join(","),
      );
    });
    for (const pid of pids) expect(alive(pid)).toBe(false);
  });

  it("kill() stops one session and leaves its neighbour running", async () => {
    await withSessions(async (sessions) => {
      const doomed = await Effect.runPromise(script(sessions, "sleep 30"));
      const spared = await Effect.runPromise(script(sessions, "sleep 30"));

      await Effect.runPromise(sessions.kill(doomed.id));
      await waitFor(
        () => !alive(doomed.pid),
        () => `pid ${doomed.pid} still alive`,
      );

      expect(alive(doomed.pid)).toBe(false);
      expect(alive(spared.pid)).toBe(true);
      // Killed means gone from the registry, not merely marked.
      const error = await Effect.runPromise(Effect.flip(sessions.get(doomed.id)));
      expect(error._tag).toBe("NotFoundError");
      expect((await Effect.runPromise(sessions.list)).map((s) => s.id)).toEqual([spared.id]);
    });
  });

  it("a shell that ignores SIGHUP still dies when shutdown beats the grace window", async () => {
    // The window this closes: `kill` dropped the session from `sessions` AND
    // `processWide` at request time, so for the 250 ms grace it was invisible to
    // both backstops — and the escalating SIGKILL timer is `unref`'d, so it
    // cannot fire during shutdown either. `trap "" HUP` makes the shell ignore
    // the polite signal, and closing the scope immediately afterwards is the
    // `/shutdown` that used to leave it running. The loop matters: a bare
    // `sleep` is a child that does NOT ignore HUP, so the shell would outlive
    // the signal only to exit the moment its one command died.
    // The grace window is opened wide so the escalating SIGKILL cannot fire and
    // rescue the outcome: whatever kills this shell is the backstop, not the
    // timer. With the real 250 ms window the timer hides the bug entirely,
    // because a test runner outlives it — the daemon, exiting, does not.
    let pid = 0;
    await withSessions(
      async (sessions) => {
        const sink = collector();
        const info = await Effect.runPromise(
          script(sessions, 'trap "" HUP; echo trapped; while :; do sleep 5; done'),
        );
        pid = info.pid;

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              yield* sessions.attach(info.id, sink.listener);
              // Wait for the trap to be INSTALLED, not merely requested —
              // killing a shell that has not reached its `trap` yet proves
              // nothing.
              yield* Effect.promise(() =>
                waitFor(
                  () => sink.text.includes("trapped"),
                  () => JSON.stringify(sink.text),
                ),
              );
            }),
          ),
        );

        await Effect.runPromise(sessions.kill(info.id));
        // Signalled, out of the registry, ignoring SIGHUP — and still running.
        expect(alive(pid)).toBe(true);
      },
      { graceMs: 60_000 },
    );

    await waitFor(
      () => !alive(pid),
      () => `pid ${pid} outlived the daemon`,
    );
    expect(alive(pid)).toBe(false);
  });

  it("killing something that is already gone is a 404, not a crash", async () => {
    await withSessions(async (sessions) => {
      const error = await Effect.runPromise(Effect.flip(sessions.kill("pty_ghost")));
      expect(error._tag).toBe("NotFoundError");
    });
  });
});

describe("writing", () => {
  it("a write to an exited shell is a no-op, not an error per keystroke", async () => {
    await withSessions(async (sessions) => {
      const info = await Effect.runPromise(script(sessions, "exit 0"));
      await settled(sessions, info.id);
      await Effect.runPromise(sessions.write(info.id, "typed after the end\n"));
    });
  });

  it("a write to a session that never existed is a 404", async () => {
    await withSessions(async (sessions) => {
      const error = await Effect.runPromise(Effect.flip(sessions.write("pty_ghost", "x")));
      expect(error._tag).toBe("NotFoundError");
    });
  });
});

describe("attach", () => {
  it("detaching stops delivery but leaves the session running", async () => {
    await withSessions(async (sessions) => {
      const sink = collector();
      const info = await Effect.runPromise(
        script(sessions, 'stty -echo; while read l; do echo "echo:$l"; done'),
      );

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* sessions.attach(info.id, sink.listener);
            yield* sessions.write(info.id, "while-attached\n");
            yield* Effect.promise(() =>
              waitFor(
                () => sink.text.includes("echo:while-attached"),
                () => JSON.stringify(sink.text),
              ),
            );
          }),
        ),
      );

      const afterDetach = sink.text;
      await Effect.runPromise(sessions.write(info.id, "after-detach\n"));
      await new Promise((resolve) => setTimeout(resolve, 400));

      // The listener is gone, so it saw nothing more…
      expect(sink.text).toBe(afterDetach);
      expect(sink.text).not.toContain("after-detach");
      // …but the shell answered anyway, and the replay buffer kept it.
      const replayed = await Effect.runPromise(
        Effect.scoped(
          Effect.map(
            sessions.attach(info.id, { onData: () => {}, onExit: () => {} }),
            (attachment) => decoder.decode(attachment.replay),
          ),
        ),
      );
      expect(replayed).toContain("echo:after-detach");
      expect((await Effect.runPromise(sessions.get(info.id))).exited).toBe(false);
    });
  });

  it("two listeners on one session both receive the same output", async () => {
    await withSessions(async (sessions) => {
      const first = collector();
      const second = collector();
      const info = await Effect.runPromise(
        script(sessions, 'stty -echo; while read l; do echo "both:$l"; done'),
      );

      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            yield* sessions.attach(info.id, first.listener);
            yield* sessions.attach(info.id, second.listener);
            yield* sessions.write(info.id, "shared\n");
            yield* Effect.promise(() =>
              waitFor(
                () => first.text.includes("both:shared") && second.text.includes("both:shared"),
                () => `${JSON.stringify(first.text)} / ${JSON.stringify(second.text)}`,
              ),
            );
          }),
        ),
      );

      expect(first.text).toContain("both:shared");
      expect(second.text).toContain("both:shared");
    });
  });

  it("attaching to nothing is a 404", async () => {
    await withSessions(async (sessions) => {
      const error = await Effect.runPromise(
        Effect.scoped(
          Effect.flip(sessions.attach("pty_ghost", { onData: () => {}, onExit: () => {} })),
        ),
      );
      expect(error._tag).toBe("NotFoundError");
    });
  });
});
