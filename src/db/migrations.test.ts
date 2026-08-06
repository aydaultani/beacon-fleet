import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

test("running migrations twice is a no-op the second time", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const firstCount = (db.prepare("SELECT COUNT(*) as n FROM _migrations").get() as { n: number }).n;

  runMigrations(db);
  const secondCount = (db.prepare("SELECT COUNT(*) as n FROM _migrations").get() as { n: number }).n;

  assert.equal(firstCount, secondCount);
  assert.ok(firstCount > 0);
  db.close();
});

test("creates the tickets and layout tables", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
    (row) => row.name,
  );
  assert.ok(tables.includes("tickets"));
  assert.ok(tables.includes("layout"));
  db.close();
});
