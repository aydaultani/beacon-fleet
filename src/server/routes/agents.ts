import type { FastifyInstance } from "fastify";
import type { DiscoveryService } from "../discovery/index.js";
import type { BeaconSession, PermissionChoice, SupervisorManager } from "../supervisor/index.js";

interface AgentSummary {
  id: string;
  sessionId?: string;
  cwd: string;
}

function summarize(session: BeaconSession): AgentSummary {
  return { id: session.id, sessionId: session.sessionId, cwd: session.cwd };
}

/** REST surface over SupervisorManager — everything here operates only on
 * agents Beacon owns. See CLAUDE.md for the discovered-vs-owned split. */
export function registerAgentRoutes(app: FastifyInstance, discovery: DiscoveryService, supervisor: SupervisorManager): void {
  app.get("/api/agents", async () => supervisor.list().map(summarize));

  app.post("/api/agents", async (req, reply) => {
    const body = req.body as { cwd?: string; model?: string; resume?: string } | undefined;
    if (!body?.cwd) {
      reply.code(400);
      return { error: "cwd is required" };
    }
    const session = supervisor.launch({ cwd: body.cwd, model: body.model, resume: body.resume });
    reply.code(201);
    return summarize(session);
  });

  app.post("/api/agents/:id/prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { text?: string } | undefined;
    const session = supervisor.get(id);
    if (!session) {
      reply.code(404);
      return { error: "unknown agent" };
    }
    if (!body?.text) {
      reply.code(400);
      return { error: "text is required" };
    }
    session.send(body.text);
    reply.code(202);
    return { ok: true };
  });

  app.post("/api/agents/:id/interrupt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = supervisor.get(id);
    if (!session) {
      reply.code(404);
      return { error: "unknown agent" };
    }
    await session.interrupt();
    return { ok: true };
  });

  app.post("/api/agents/:id/kill", async (req, reply) => {
    const { id } = req.params as { id: string };
    const killed = supervisor.kill(id);
    if (!killed) {
      reply.code(404);
      return { error: "unknown agent" };
    }
    return { ok: true };
  });

  app.post("/api/agents/:id/permissions/:requestId", async (req, reply) => {
    const { id, requestId } = req.params as { id: string; requestId: string };
    const body = req.body as { choice?: PermissionChoice; updatedInput?: Record<string, unknown> } | undefined;
    const session = supervisor.get(id);
    if (!session) {
      reply.code(404);
      return { error: "unknown agent" };
    }
    if (!body?.choice) {
      reply.code(400);
      return { error: "choice is required" };
    }
    const resolved = session.resolvePermission(requestId, body.choice, body.updatedInput);
    if (!resolved) {
      reply.code(404);
      return { error: "unknown or already-resolved permission request" };
    }
    return { ok: true };
  });

  // Adopt-via-resume: promote a discovered (external) session to owned.
  // See CLAUDE.md for why this exists instead of the private control socket.
  app.post("/api/sessions/:sessionId/adopt", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const discovered = discovery.list().find((s) => s.sessionId === sessionId);
    if (!discovered) {
      reply.code(404);
      return { error: "unknown session" };
    }
    if (discovered.pid === null) {
      reply.code(409);
      return { error: "session has no known pid to adopt from" };
    }

    try {
      const session = await supervisor.adopt({
        sessionId: discovered.sessionId,
        cwd: discovered.cwd,
        pid: discovered.pid,
        procStart: discovered.procStart,
      });
      reply.code(201);
      return summarize(session);
    } catch (err) {
      reply.code(409);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
