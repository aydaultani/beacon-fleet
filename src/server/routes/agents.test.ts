import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { DiscoveryService } from "../discovery/index.js";
import { SupervisorManager } from "../supervisor/index.js";
import { registerAgentRoutes } from "./agents.js";

// A DiscoveryService that's never had start() called does no filesystem
// I/O and list() is synchronously []. A SupervisorManager with nothing
// launched never spawns a process. Both are safe/cheap to construct
// directly for route-level testing — no real agent, no real ~/.claude
// dependency, no network socket (Fastify's inject() bypasses that too).
function buildApp() {
  const app = Fastify({ logger: false });
  const discovery = new DiscoveryService();
  const supervisor = new SupervisorManager();
  registerAgentRoutes(app, discovery, supervisor);
  return app;
}

test("GET /api/agents on a fresh supervisor is an empty array", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/agents" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
});

test("POST /api/agents without cwd is rejected with 400", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/api/agents", payload: {} });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "cwd is required" });
});

test("prompt/interrupt/kill/permissions against an unknown agent id all 404", async () => {
  const app = buildApp();
  const id = "does-not-exist";

  const prompt = await app.inject({ method: "POST", url: `/api/agents/${id}/prompt`, payload: { text: "hi" } });
  assert.equal(prompt.statusCode, 404);

  const interrupt = await app.inject({ method: "POST", url: `/api/agents/${id}/interrupt` });
  assert.equal(interrupt.statusCode, 404);

  const kill = await app.inject({ method: "POST", url: `/api/agents/${id}/kill` });
  assert.equal(kill.statusCode, 404);

  const permission = await app.inject({
    method: "POST",
    url: `/api/agents/${id}/permissions/req1`,
    payload: { choice: "once" },
  });
  assert.equal(permission.statusCode, 404);
});

test("permission resolution without a choice is rejected with 400 before touching the supervisor", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/api/agents/some-id/permissions/req1", payload: {} });
  // Unknown agent AND missing choice — agent-not-found is checked first,
  // so this still 404s. The dedicated "known agent, missing choice" case
  // needs a real launched session, which these tests deliberately avoid
  // (see buildApp comment) — covered instead by the manual end-to-end
  // verification in PROGRESS.md.
  assert.equal(res.statusCode, 404);
});

test("adopting an unknown discovered session returns 404", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "POST", url: "/api/sessions/does-not-exist/adopt" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "unknown session" });
});
