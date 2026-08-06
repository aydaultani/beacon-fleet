import type { DatabaseSync } from "node:sqlite";

/**
 * A tile's position on the fleet board and, optionally, which tile it's
 * nested under. This is Beacon's own spatial organization of sessions and
 * agents for the browser UI — not a reflection of Claude Code's real
 * process/subagent hierarchy, which can't be rewritten. See CLAUDE.md.
 */
export interface LayoutTile {
  tileId: string;
  x: number;
  y: number;
  parentTileId: string | null;
}

interface LayoutRow {
  tile_id: string;
  x: number;
  y: number;
  parent_tile_id: string | null;
}

function rowToTile(row: LayoutRow): LayoutTile {
  return { tileId: row.tile_id, x: row.x, y: row.y, parentTileId: row.parent_tile_id };
}

export class SqliteLayoutStore {
  constructor(private readonly db: DatabaseSync) {}

  getLayout(): LayoutTile[] {
    const rows = this.db.prepare(`SELECT * FROM layout`).all() as unknown as LayoutRow[];
    return rows.map(rowToTile);
  }

  setTilePosition(tileId: string, x: number, y: number, parentTileId: string | null = null): LayoutTile {
    this.db
      .prepare(`
        INSERT INTO layout (tile_id, x, y, parent_tile_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tile_id) DO UPDATE SET x = excluded.x, y = excluded.y, parent_tile_id = excluded.parent_tile_id
      `)
      .run(tileId, x, y, parentTileId);
    return { tileId, x, y, parentTileId };
  }
}
