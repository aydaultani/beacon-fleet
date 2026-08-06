import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { DiscoveryService } from "../discovery/index.js";
import { registerSubagentRoutes } from "./subagents.js";

// Same pattern as agents.test.ts: a DiscoveryService that's never had
// start() called does no filesystem I/O and list() is synchronously [].
function buildApp() {
  const app = Fastify({ logger: false });
  registerSubagentRoutes(app, new DiscoveryService());
  return app;
}

test("GET /api/sessions/:id/subagents on an unknown session 404s", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/sessions/does-not-exist/subagents" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "unknown session" });
});

test("GET /api/sessions/:id/subagents/:agentId/transcript on an unknown session 404s", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/sessions/does-not-exist/subagents/a1/transcript" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "unknown session" });
});
