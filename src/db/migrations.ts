import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    description: "create tickets and layout tables",
    sql: `
      CREATE TABLE tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'med',
        project TEXT NOT NULL,
        assignee TEXT,
        parent_id INTEGER REFERENCES tickets(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_tickets_status ON tickets(status);
      CREATE INDEX idx_tickets_project ON tickets(project);
      CREATE INDEX idx_tickets_parent_id ON tickets(parent_id);

      CREATE TABLE layout (
        tile_id TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        parent_tile_id TEXT
      );
    `,
  },
];

/**
 * Applies every migration not yet recorded in `_migrations`, in version
 * order. Idempotent — safe to call on every process start.
 */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);

  const appliedRows = db.prepare(`SELECT version FROM _migrations`).all() as { version: number }[];
  const applied = new Set(appliedRows.map((row) => row.version));

  const insertRecord = db.prepare(`INSERT INTO _migrations (version, applied_at) VALUES (?, ?)`);

  for (const migration of migrations.sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    db.exec(migration.sql);
    insertRecord.run(migration.version, Date.now());
  }
}
