import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";
import { SqliteLayoutStore } from "./layout.js";

function buildStore(): SqliteLayoutStore {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  return new SqliteLayoutStore(db);
}

test("getLayout is empty before anything is placed", () => {
  const layout = buildStore();
  assert.deepEqual(layout.getLayout(), []);
});

test("setTilePosition persists a new tile", () => {
  const layout = buildStore();
  const tile = layout.setTilePosition("session-1", 10, 20);
  assert.deepEqual(tile, { tileId: "session-1", x: 10, y: 20, parentTileId: null });
  assert.deepEqual(layout.getLayout(), [tile]);
});

test("setTilePosition on an existing tile updates in place rather than duplicating", () => {
  const layout = buildStore();
  layout.setTilePosition("session-1", 10, 20);
  layout.setTilePosition("session-1", 50, 60);

  const all = layout.getLayout();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.x, 50);
  assert.equal(all[0]?.y, 60);
});

test("nesting one tile under another persists parentTileId", () => {
  const layout = buildStore();
  layout.setTilePosition("parent-session", 0, 0);
  layout.setTilePosition("child-session", 10, 10, "parent-session");

  const all = layout.getLayout();
  const child = all.find((t) => t.tileId === "child-session");
  assert.equal(child?.parentTileId, "parent-session");
});

test("un-nesting a tile clears parentTileId back to null", () => {
  const layout = buildStore();
  layout.setTilePosition("child-session", 10, 10, "parent-session");
  layout.setTilePosition("child-session", 10, 10, null);

  const all = layout.getLayout();
  assert.equal(all[0]?.parentTileId, null);
});
