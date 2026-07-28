// The byte ring's ceiling — the property the replay buffer and the socket
// backlog both rest on. Pure, so it is provable in microseconds rather than by
// pushing a quarter megabyte through a shell.

import { describe, expect, it } from "vite-plus/test";
import { ByteRing } from "./Replay.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (buffer: Uint8Array): string => new TextDecoder().decode(buffer);

describe("ByteRing — the bound holds after every push", () => {
  it("keeps everything while it fits", () => {
    const ring = new ByteRing(64);
    ring.push(bytes("hello "));
    ring.push(bytes("world"));
    expect(text(ring.drain())).toBe("hello world");
    expect(ring.bytes).toBe(11);
    expect(ring.dropped).toBe(0);
  });

  it("drops from the OLDEST end, never the newest", () => {
    const ring = new ByteRing(10);
    ring.push(bytes("aaaaa"));
    ring.push(bytes("bbbbb"));
    ring.push(bytes("ccccc"));
    // The most recent output is what a terminal is for; the first chunk goes.
    expect(text(ring.drain())).toBe("bbbbbccccc");
    expect(ring.bytes).toBe(10);
    expect(ring.dropped).toBe(5);
  });

  it("never exceeds the limit, over many pushes of many sizes", () => {
    const ring = new ByteRing(100);
    for (let i = 0; i < 500; i += 1) {
      ring.push(bytes("x".repeat((i % 17) + 1)));
      // The invariant is checked after EVERY push, not once at the end — an
      // average that stays under the bound is not the same as a ceiling.
      expect(ring.bytes).toBeLessThanOrEqual(100);
    }
    expect(ring.dropped).toBeGreaterThan(0);
  });

  it("clips a single chunk larger than the whole bound to its tail", () => {
    const ring = new ByteRing(8);
    ring.push(bytes("0123456789ABCDEF"));
    expect(ring.bytes).toBe(8);
    expect(text(ring.drain())).toBe("89ABCDEF");
    expect(ring.dropped).toBe(8);
  });

  it("counts every dropped byte rather than losing the fact of the loss", () => {
    const ring = new ByteRing(4);
    ring.push(bytes("aaaa"));
    ring.push(bytes("bbbb"));
    ring.push(bytes("cccc"));
    expect(ring.dropped).toBe(8);
    expect(ring.bytes).toBe(4);
  });

  it("ignores empty pushes", () => {
    const ring = new ByteRing(4);
    ring.push(new Uint8Array(0));
    expect(ring.empty).toBe(true);
    expect(ring.bytes).toBe(0);
  });

  it("take() hands over everything and leaves the ring empty", () => {
    const ring = new ByteRing(16);
    ring.push(bytes("abc"));
    expect(text(ring.take())).toBe("abc");
    expect(ring.empty).toBe(true);
    expect(text(ring.take())).toBe("");
  });

  it("drain() is non-destructive — a second attach sees the same history", () => {
    const ring = new ByteRing(16);
    ring.push(bytes("abc"));
    expect(text(ring.drain())).toBe("abc");
    expect(text(ring.drain())).toBe("abc");
    expect(ring.bytes).toBe(3);
  });

  it("refuses a nonsensical limit rather than silently holding nothing", () => {
    expect(() => new ByteRing(0)).toThrow(RangeError);
    expect(() => new ByteRing(-1)).toThrow(RangeError);
    expect(() => new ByteRing(1.5)).toThrow(RangeError);
  });
});
