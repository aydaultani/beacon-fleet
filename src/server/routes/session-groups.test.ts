import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { runMigrations } from "../../db/migrations.js";
import { SqliteSessionGroupsStore } from "../../db/session-groups.js";
import { registerSessionGroupRoutes } from "./session-groups.js";

function buildApp() {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const app = Fastify({ logger: false });
  registerSessionGroupRoutes(app, new SqliteSessionGroupsStore(db));
  return app;
}

test("GET /api/session-groups on a fresh store is two empty maps", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/session-groups" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { overrides: {}, names: {} });
});

test("PUT /api/session-groups/:sessionId without groupId is rejected with 400", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "PUT", url: "/api/session-groups/session-1", payload: {} });
  assert.equal(res.statusCode, 400);
});

test("PUT /api/session-groups/:sessionId sets an override, reflected in the GET", async () => {
  const app = buildApp();
  const put = await app.inject({
    method: "PUT",
    url: "/api/session-groups/session-1",
    payload: { groupId: "my-group" },
  });
  assert.equal(put.statusCode, 200);

  const get = await app.inject({ method: "GET", url: "/api/session-groups" });
  assert.deepEqual(get.json().overrides, { "session-1": "my-group" });
});

test("PUT /api/session-groups/:sessionId with groupId null clears the override", async () => {
  const app = buildApp();
  await app.inject({ method: "PUT", url: "/api/session-groups/session-1", payload: { groupId: "my-group" } });
  await app.inject({ method: "PUT", url: "/api/session-groups/session-1", payload: { groupId: null } });

  const get = await app.inject({ method: "GET", url: "/api/session-groups" });
  assert.deepEqual(get.json().overrides, {});
});

test("PUT .../group/:groupId/name without a name is rejected with 400", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "PUT", url: "/api/session-groups/group/my-group/name", payload: {} });
  assert.equal(res.statusCode, 400);
});

test("PUT .../group/:groupId/name sets the name, reflected in the GET", async () => {
  const app = buildApp();
  const put = await app.inject({
    method: "PUT",
    url: "/api/session-groups/group/cwd:%2Ftmp%2Fproj/name",
    payload: { name: "My Project" },
  });
  assert.equal(put.statusCode, 200);

  const get = await app.inject({ method: "GET", url: "/api/session-groups" });
  assert.deepEqual(get.json().names, { "cwd:/tmp/proj": "My Project" });
});
