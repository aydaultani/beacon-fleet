import { test } from "node:test";
import assert from "node:assert/strict";
import { isPidAlive } from "./liveness.js";

test("the current process is reported alive", () => {
  assert.equal(isPidAlive(process.pid), true);
});

test("an implausible pid is reported not alive", () => {
  assert.equal(isPidAlive(999999999), false);
});
