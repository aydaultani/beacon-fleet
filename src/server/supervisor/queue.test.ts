import { test } from "node:test";
import assert from "node:assert/strict";
import { PushQueue } from "./queue.js";

test("yields items pushed before iteration starts", async () => {
  const queue = new PushQueue<number>();
  queue.push(1);
  queue.push(2);
  queue.close();

  const seen: number[] = [];
  for await (const item of queue) seen.push(item);
  assert.deepEqual(seen, [1, 2]);
});

test("blocks on an empty open queue until an item is pushed", async () => {
  const queue = new PushQueue<string>();
  const iterator = queue[Symbol.asyncIterator]();

  const pending = iterator.next();
  let resolved = false;
  void pending.then(() => {
    resolved = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(resolved, false, "must not resolve before a push, or the underlying session's stdin would close early");

  queue.push("hello");
  const result = await pending;
  assert.deepEqual(result, { value: "hello", done: false });
});

test("close() ends iteration without yielding a final value", async () => {
  const queue = new PushQueue<number>();
  queue.push(1);
  queue.close();

  const seen: number[] = [];
  for await (const item of queue) seen.push(item);
  assert.deepEqual(seen, [1]);
});

test("push() after close() throws", () => {
  const queue = new PushQueue<number>();
  queue.close();
  assert.throws(() => queue.push(1));
});

test("close() unblocks a pending iterator wait", async () => {
  const queue = new PushQueue<number>();
  const iterator = queue[Symbol.asyncIterator]();
  const pending = iterator.next();

  queue.close();
  const result = await pending;
  assert.equal(result.done, true);
});
