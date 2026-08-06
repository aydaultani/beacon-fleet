import type { FastifyInstance } from "fastify";
import type { SqliteLayoutStore } from "../../db/index.js";

/** The user's own drag-to-nest spatial organization of the fleet board —
 * see db/layout.ts and CLAUDE.md. */
export function registerLayoutRoutes(app: FastifyInstance, layout: SqliteLayoutStore): void {
  app.get("/api/layout", async () => layout.getLayout());

  app.put("/api/layout/:tileId", async (req, reply) => {
    const { tileId } = req.params as { tileId: string };
    const body = req.body as { x?: number; y?: number; parentTileId?: string | null } | undefined;
    if (typeof body?.x !== "number" || typeof body?.y !== "number") {
      reply.code(400);
      return { error: "x and y are required numbers" };
    }
    return layout.setTilePosition(tileId, body.x, body.y, body.parentTileId ?? null);
  });
}
