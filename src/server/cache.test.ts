import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache } from "./cache.js";

function fakeClock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test("get/set round-trip within the TTL", () => {
  const clock = fakeClock();
  const cache = new TtlCache<string, number>(1000, clock.now);
  cache.set("a", 42);
  assert.equal(cache.get("a"), 42);
});

test("get returns undefined once the TTL has elapsed, and evicts the entry", () => {
  const clock = fakeClock();
  const cache = new TtlCache<string, number>(1000, clock.now);
  cache.set("a", 42);
  clock.advance(1000);
  assert.equal(cache.get("a"), undefined);
});

test("get returns undefined for a key that was never set", () => {
  const cache = new TtlCache<string, number>(1000);
  assert.equal(cache.get("missing"), undefined);
});

test("getOrCompute only calls compute() once while the value is fresh", async () => {
  const clock = fakeClock();
  const cache = new TtlCache<string, number>(1000, clock.now);
  let calls = 0;
  const compute = async () => {
    calls++;
    return 7;
  };
  assert.equal(await cache.getOrCompute("a", compute), 7);
  assert.equal(await cache.getOrCompute("a", compute), 7);
  assert.equal(calls, 1);
});

test("getOrCompute recomputes once the TTL has elapsed", async () => {
  const clock = fakeClock();
  const cache = new TtlCache<string, number>(1000, clock.now);
  let calls = 0;
  const compute = async () => {
    calls++;
    return calls;
  };
  assert.equal(await cache.getOrCompute("a", compute), 1);
  clock.advance(1000);
  assert.equal(await cache.getOrCompute("a", compute), 2);
  assert.equal(calls, 2);
});

test("delete forces the next get/getOrCompute to miss", async () => {
  const cache = new TtlCache<string, number>(1000);
  cache.set("a", 1);
  cache.delete("a");
  assert.equal(cache.get("a"), undefined);
});

test("clear empties every key", () => {
  const cache = new TtlCache<string, number>(1000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.clear();
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), undefined);
});

test("different keys are cached independently", () => {
  const cache = new TtlCache<string, number>(1000);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), 2);
});
