/**
 * An AsyncIterable you can push into from anywhere (an HTTP handler, a WS
 * message). Passing this as `query()`'s `prompt` is what puts an Agent SDK
 * session into streaming-input mode — the only mode where `interrupt()`,
 * `setPermissionMode()`, etc. work. The iterator blocks indefinitely on an
 * empty, open queue rather than returning, which is what keeps the
 * underlying session's stdin open between turns. See CLAUDE.md.
 */
export class PushQueue<T> {
  private items: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) throw new Error("PushQueue is closed");
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as unknown as T, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift() as T;
        continue;
      }
      if (this.closed) return;
      const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (result.done) return;
      yield result.value;
    }
  }
}
