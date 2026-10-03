// A small sliding-window counter (stage-9.md §6.4): one for pair attempts, one for unknown keys.
// In memory, with the clock passed to every call; a restart resets it (accepted: a restart also
// cancels the open pairing code).

export interface LimitDecision {
  allowed: boolean;
  /** When refused: whole seconds until the oldest counted attempt leaves the window (≥ 1). */
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  private hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private prune(nowMs: number): void {
    const from = nowMs - this.windowMs;
    let drop = 0;
    while (drop < this.hits.length && this.hits[drop]! <= from) drop += 1;
    if (drop > 0) this.hits = this.hits.slice(drop);
  }

  /** The attempts counted in the window ending at `nowMs`. */
  count(nowMs: number): number {
    this.prune(nowMs);
    return this.hits.length;
  }

  /** Whether one more attempt is allowed now, without counting it. */
  check(nowMs: number): LimitDecision {
    this.prune(nowMs);
    if (this.hits.length < this.max) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = this.hits[0]!;
    const waitMs = oldest + this.windowMs - nowMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  /** Counts one attempt (call after `check` allowed it). */
  record(nowMs: number): void {
    this.prune(nowMs);
    this.hits.push(nowMs);
  }

  /** `check`, then `record` when allowed. */
  hit(nowMs: number): LimitDecision {
    const decision = this.check(nowMs);
    if (decision.allowed) this.record(nowMs);
    return decision;
  }
}
