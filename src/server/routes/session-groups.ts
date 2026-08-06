import type { FastifyInstance } from "fastify";
import type { SqliteSessionGroupsStore } from "../../db/index.js";

/** See db/session-groups.ts for the model. The frontend already has the
 * live session list (via /api/sessions or /ws) and computes each
 * session's effective group itself -- this just serves the two small
 * override/name maps it joins against. */
export function registerSessionGroupRoutes(app: FastifyInstance, groups: SqliteSessionGroupsStore): void {
  app.get("/api/session-groups", async () => ({
    overrides: groups.getOverrides(),
    names: groups.getNames(),
  }));

  app.put("/api/session-groups/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const body = req.body as { groupId?: string | null } | undefined;
    if (body?.groupId === undefined) {
      reply.code(400);
      return { error: "groupId is required (a string, or null to clear the override)" };
    }
    groups.setOverride(sessionId, body.groupId);
    return { ok: true };
  });

  app.put("/api/session-groups/group/:groupId/name", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    const body = req.body as { name?: string } | undefined;
    if (!body?.name?.trim()) {
      reply.code(400);
      return { error: "name is required" };
    }
    groups.setName(groupId, body.name.trim());
    return { ok: true };
  });
}
