import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { runMigrations } from "../../db/migrations.js";
import { SqliteLayoutStore } from "../../db/layout.js";
import { registerLayoutRoutes } from "./layout.js";

function buildApp() {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const app = Fastify({ logger: false });
  registerLayoutRoutes(app, new SqliteLayoutStore(db));
  return app;
}

test("GET /api/layout on a fresh store is an empty array", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/layout" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
});

test("PUT /api/layout/:tileId without numeric x/y is rejected with 400", async () => {
  const app = buildApp();
  const missing = await app.inject({ method: "PUT", url: "/api/layout/tile-1", payload: {} });
  assert.equal(missing.statusCode, 400);
  assert.deepEqual(missing.json(), { error: "x and y are required numbers" });

  const wrongType = await app.inject({ method: "PUT", url: "/api/layout/tile-1", payload: { x: "10", y: 20 } });
  assert.equal(wrongType.statusCode, 400);
});

test("PUT /api/layout/:tileId persists a tile position, reflected in GET /api/layout", async () => {
  const app = buildApp();
  const put = await app.inject({ method: "PUT", url: "/api/layout/session-1", payload: { x: 10, y: 20 } });
  assert.equal(put.statusCode, 200);
  assert.deepEqual(put.json(), { tileId: "session-1", x: 10, y: 20, parentTileId: null });

  const list = await app.inject({ method: "GET", url: "/api/layout" });
  assert.deepEqual(list.json(), [{ tileId: "session-1", x: 10, y: 20, parentTileId: null }]);
});

test("PUT /api/layout/:tileId on an existing tile updates in place, not a duplicate", async () => {
  const app = buildApp();
  await app.inject({ method: "PUT", url: "/api/layout/session-1", payload: { x: 10, y: 20 } });
  await app.inject({ method: "PUT", url: "/api/layout/session-1", payload: { x: 50, y: 60 } });

  const list = await app.inject({ method: "GET", url: "/api/layout" });
  const tiles = list.json();
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].x, 50);
  assert.equal(tiles[0].y, 60);
});

test("PUT /api/layout/:tileId with parentTileId nests it, and null un-nests it", async () => {
  const app = buildApp();
  await app.inject({ method: "PUT", url: "/api/layout/parent", payload: { x: 0, y: 0 } });
  const nested = await app.inject({
    method: "PUT",
    url: "/api/layout/child",
    payload: { x: 10, y: 10, parentTileId: "parent" },
  });
  assert.equal(nested.json().parentTileId, "parent");

  const unnested = await app.inject({
    method: "PUT",
    url: "/api/layout/child",
    payload: { x: 10, y: 10, parentTileId: null },
  });
  assert.equal(unnested.json().parentTileId, null);
});
