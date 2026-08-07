/**
 * A tiny time-to-live cache for read-mostly, expensive-to-recompute
 * values (e.g. a directory listing) sitting in front of a fast-changing
 * live view. The TTL is deliberately kept well under whatever polling
 * interval the caller is serving — it exists to absorb *redundant*
 * near-duplicate reads (multiple tabs, a remount storm from switching
 * groups quickly), not to make data stale. `now` is injectable so tests
 * never need a real sleep to exercise expiry.
 */
export class TtlCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Serve a cached value if fresh; otherwise compute, cache, and return
   * it. Concurrent callers for the same still-computing key each start
   * their own compute() rather than sharing one in-flight promise — the
   * TTL is short enough, and the underlying reads cheap enough (a single
   * directory listing), that request coalescing isn't worth the added
   * complexity here. */
  async getOrCompute(key: K, compute: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
