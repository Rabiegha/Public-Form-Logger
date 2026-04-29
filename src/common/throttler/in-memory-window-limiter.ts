/**
 * Simple in-memory sliding-window rate limiter for V1 (single-instance deploy).
 * For multi-instance prod, swap to Redis later.
 *
 * Each key (IP or public_token) gets a fixed-window counter that resets every
 * `windowMs`. Cheap, predictable, no external deps.
 */
export class InMemoryWindowLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    // Periodic cleanup of expired buckets to bound memory.
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.max(windowMs, 60_000)).unref();
  }

  /**
   * @returns true if the request is allowed; false if rate-limited.
   */
  hit(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterSec: 0 };
    }

    bucket.count += 1;
    const remaining = Math.max(0, this.limit - bucket.count);
    if (bucket.count > this.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      };
    }
    return { allowed: true, remaining, retryAfterSec: 0 };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, b] of this.buckets) {
      if (b.resetAt <= now) this.buckets.delete(key);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.buckets.clear();
  }
}
