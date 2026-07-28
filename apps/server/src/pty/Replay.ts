// A bounded byte ring — the one place a "keep the last N bytes" decision is
// made, so the replay buffer and a socket's outbound backlog cannot disagree
// about what bounded means.
//
// Both uses want the same three properties:
//   - a hard byte ceiling that holds after every push, not on average;
//   - drops taken from the OLDEST end, because a terminal's recent output is
//     the part worth keeping; and
//   - a count of what was dropped, so the reader can say "history starts here"
//     rather than implying it has everything.

/**
 * A fixed-capacity queue of byte chunks.
 *
 * Chunks are kept whole while that is possible: a pty read is a coherent run of
 * bytes and dropping whole ones keeps multi-byte characters intact. The single
 * exception is a chunk larger than the entire bound, which is clipped to its
 * tail — that can sever a UTF-8 sequence at the very head of the buffer, worth
 * at most one replacement glyph on the first repainted line, and it is what
 * keeps `bytes <= limit` an invariant rather than a hope.
 */
export class ByteRing {
  readonly limit: number;
  private chunks: Uint8Array[] = [];
  private held = 0;
  private lost = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`ByteRing limit must be a positive integer, got ${limit}`);
    }
    this.limit = limit;
  }

  /** Bytes currently held. Never greater than `limit`. */
  get bytes(): number {
    return this.held;
  }

  /** Bytes pushed and since discarded to stay under the bound. */
  get dropped(): number {
    return this.lost;
  }

  get empty(): boolean {
    return this.held === 0;
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.chunks.push(chunk);
    this.held += chunk.byteLength;

    // Whole chunks first — the common path, and the one that never splits a
    // character.
    while (this.held > this.limit && this.chunks.length > 1) {
      const oldest = this.chunks.shift();
      if (oldest === undefined) break;
      this.held -= oldest.byteLength;
      this.lost += oldest.byteLength;
    }

    // One chunk, still over: clip it to its tail so the ceiling holds.
    if (this.held > this.limit) {
      const only = this.chunks[0];
      if (only !== undefined) {
        const kept = only.subarray(only.byteLength - this.limit);
        this.lost += only.byteLength - kept.byteLength;
        this.chunks = [kept];
        this.held = kept.byteLength;
      }
    }
  }

  /** Everything held, in order, as one buffer. */
  drain(): Uint8Array {
    const out = new Uint8Array(this.held);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  /** Everything held, in order, and forget it — for a backlog being flushed. */
  take(): Uint8Array {
    const out = this.drain();
    this.chunks = [];
    this.held = 0;
    return out;
  }

  clear(): void {
    this.chunks = [];
    this.held = 0;
  }
}
