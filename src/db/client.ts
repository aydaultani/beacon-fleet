import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { runMigrations } from "./migrations.js";

// esbuild (via tsup) doesn't yet recognize `node:sqlite` as a builtin with
// no bare-name alias, and rewrites a static `import ... from "node:sqlite"`
// to the invalid bare specifier "sqlite" in the bundled output. Loading it
// through require() instead — a plain runtime string, not a static import
// esbuild rewrites — sidesteps that entirely. Node's own require() has
// always resolved the node: prefix correctly.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const DEFAULT_DB_PATH = join(homedir(), ".beacon", "beacon.db");

/**
 * Opens (creating if needed) the Beacon SQLite database and applies any
 * pending migrations. Uses the built-in `node:sqlite` rather than
 * better-sqlite3 so installing Beacon never requires a native build
 * toolchain. Pass an explicit `path` (e.g. `:memory:`) for tests.
 */
export function openDatabase(path: string = DEFAULT_DB_PATH): DatabaseSyncType {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  runMigrations(db);
  return db;
}
