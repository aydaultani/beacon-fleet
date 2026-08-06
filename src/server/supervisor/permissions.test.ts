import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionBridge } from "./permissions.js";

function fakeOpts(toolUseID: string, overrides: Partial<{ signal: AbortSignal; title: string }> = {}) {
  return {
    signal: overrides.signal ?? new AbortController().signal,
    toolUseID,
    requestId: `req_${toolUseID}`,
    title: overrides.title,
  };
}

test("onRequest fires with the request details before canUseTool resolves", async () => {
  const bridge = new PermissionBridge();
  let seen: unknown;
  bridge.onRequest = (request) => {
    seen = request;
  };

  const pending = bridge.canUseTool("Bash", { command: "ls" }, fakeOpts("t1"));
  // onRequest must fire synchronously-ish, before resolution — give the
  // microtask queue a tick without resolving the request.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(seen, {
    id: "t1",
    toolName: "Bash",
    input: { command: "ls" },
    title: "Claude wants to use Bash",
    displayName: undefined,
    description: undefined,
    agentID: undefined,
  });

  bridge.resolve("t1", "once");
  await pending;
});

test("resolve('once') allows with temporary classification and the original input", async () => {
  const bridge = new PermissionBridge();
  const pending = bridge.canUseTool("Read", { file_path: "x" }, fakeOpts("t1"));
  await Promise.resolve();
  const resolved = bridge.resolve("t1", "once");
  assert.equal(resolved, true);

  const result = await pending;
  assert.deepEqual(result, {
    behavior: "allow",
    updatedInput: { file_path: "x" },
    decisionClassification: "user_temporary",
  });
});

test("resolve('always') allows with permanent classification", async () => {
  const bridge = new PermissionBridge();
  const pending = bridge.canUseTool("Read", {}, fakeOpts("t1"));
  await Promise.resolve();
  bridge.resolve("t1", "always");
  const result = await pending;
  assert.ok(result);
  assert.equal(result.behavior, "allow");
  assert.equal((result as { decisionClassification: string }).decisionClassification, "user_permanent");
});

test("resolve('deny') denies with a user-facing message", async () => {
  const bridge = new PermissionBridge();
  const pending = bridge.canUseTool("Bash", {}, fakeOpts("t1"));
  await Promise.resolve();
  bridge.resolve("t1", "deny");
  const result = await pending;
  assert.deepEqual(result, {
    behavior: "deny",
    message: "User denied this action",
    decisionClassification: "user_reject",
  });
});

test("resolve() can override the input the tool actually runs with", async () => {
  const bridge = new PermissionBridge();
  const pending = bridge.canUseTool("Read", { file_path: "original" }, fakeOpts("t1"));
  await Promise.resolve();
  bridge.resolve("t1", "once", { file_path: "edited" });
  const result = await pending;
  assert.equal((result as { updatedInput: Record<string, unknown> }).updatedInput.file_path, "edited");
});

test("resolve() on an unknown or already-resolved id returns false and does not throw", () => {
  const bridge = new PermissionBridge();
  assert.equal(bridge.resolve("nonexistent", "once"), false);
});

test("resolve() is not double-callable for the same request", async () => {
  const bridge = new PermissionBridge();
  const pending = bridge.canUseTool("Bash", {}, fakeOpts("t1"));
  await Promise.resolve();
  assert.equal(bridge.resolve("t1", "once"), true);
  assert.equal(bridge.resolve("t1", "deny"), false);
  await pending;
});

test("aborting the signal denies as a cancellation, distinct from a user deny", async () => {
  const bridge = new PermissionBridge();
  const controller = new AbortController();
  const pending = bridge.canUseTool("Bash", {}, fakeOpts("t1", { signal: controller.signal }));
  await Promise.resolve();

  controller.abort();
  const result = await pending;
  assert.deepEqual(result, {
    behavior: "deny",
    message: "Cancelled",
    decisionClassification: "user_reject",
  });

  // A late resolve() after abort must be a no-op, not a second resolution.
  assert.equal(bridge.resolve("t1", "once"), false);
});
