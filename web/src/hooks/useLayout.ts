import { useCallback, useEffect, useState } from "react";

export interface LayoutTile {
  tileId: string;
  x: number;
  y: number;
  parentTileId: string | null;
}

export interface UseLayoutResult {
  layout: Map<string, LayoutTile>;
  setTilePosition: (tileId: string, x: number, y: number, parentTileId: string | null) => void;
}

/** The user's own drag-to-nest spatial organization of the fleet board —
 * persisted via /api/layout, entirely separate from Claude Code's real
 * process/subagent hierarchy. See CLAUDE.md. */
export function useLayout(): UseLayoutResult {
  const [layout, setLayout] = useState<Map<string, LayoutTile>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/layout")
      .then((res) => (res.ok ? res.json() : []))
      .then((tiles: LayoutTile[]) => {
        if (!cancelled) setLayout(new Map(tiles.map((t) => [t.tileId, t])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setTilePosition = useCallback((tileId: string, x: number, y: number, parentTileId: string | null) => {
    const tile: LayoutTile = { tileId, x, y, parentTileId };
    // Optimistic — the board should feel instant; a failed PUT just means
    // the position doesn't survive a refresh, not a broken interaction.
    setLayout((prev) => new Map(prev).set(tileId, tile));
    void fetch(`/api/layout/${encodeURIComponent(tileId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x, y, parentTileId }),
    });
  }, []);

  return { layout, setTilePosition };
}
