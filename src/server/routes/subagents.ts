import type { FastifyInstance } from "fastify";
import type { DiscoveryService } from "../discovery/index.js";
import { listSubagents, readSubagentTranscriptSince } from "../transcripts/index.js";

/** Real Claude Code subagents (Task-tool sub-conversations) under a
 * session — see transcripts/subagents.ts. Keyed by sessionId like the main
 * transcript route, since a subagent's on-disk location is derived from
 * its parent session's cwd + id, not from anything Beacon tracks itself. */
export function registerSubagentRoutes(app: FastifyInstance, discovery: DiscoveryService): void {
  app.get("/api/sessions/:sessionId/subagents", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const session = discovery.list().find((s) => s.sessionId === sessionId);
    if (!session) {
      reply.code(404);
      return { error: "unknown session" };
    }
    return listSubagents(session.cwd, sessionId);
  });

  app.get("/api/sessions/:sessionId/subagents/:agentId/transcript", async (req, reply) => {
    const { sessionId, agentId } = req.params as { sessionId: string; agentId: string };
    const { offset } = req.query as { offset?: string };
    const parsedOffset = offset ? Number.parseInt(offset, 10) : 0;

    const session = discovery.list().find((s) => s.sessionId === sessionId);
    if (!session) {
      reply.code(404);
      return { error: "unknown session" };
    }

    return readSubagentTranscriptSince(session.cwd, sessionId, agentId, Number.isFinite(parsedOffset) ? parsedOffset : 0);
  });
}
