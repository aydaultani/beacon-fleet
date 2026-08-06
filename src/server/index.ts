import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { registerAuthGate, isLoopbackHost } from "./auth.js";
import { DiscoveryService } from "./discovery/index.js";
import { readTranscriptSince } from "./transcripts/index.js";
import { SupervisorManager } from "./supervisor/index.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerTicketRoutes } from "./routes/tickets.js";
import { registerLayoutRoutes } from "./routes/layout.js";
import { registerFsRoutes } from "./routes/fs.js";
import { registerSubagentRoutes } from "./routes/subagents.js";
import { registerSessionGroupRoutes } from "./routes/session-groups.js";
import { registerWebSocketHub } from "./ws.js";
import { openDatabase, SqliteTicketsCore, SqliteLayoutStore, SqliteSessionGroupsStore } from "../db/index.js";
import { registerTicketsMcpRoute } from "./mcp/http-server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StartServerOptions {
  port: number;
  host: string;
}

export interface StartedServer {
  app: FastifyInstance;
  url: string;
}

export async function startServer({ port, host }: StartServerOptions): Promise<StartedServer> {
  const app = Fastify({ logger: false });

  const token = registerAuthGate(app, host);

  const discovery = new DiscoveryService();
  await discovery.start();
  app.addHook("onClose", async () => discovery.stop());

  const db = openDatabase();
  app.addHook("onClose", async () => db.close());
  const tickets = new SqliteTicketsCore(db);
  const layout = new SqliteLayoutStore(db);
  const sessionGroups = new SqliteSessionGroupsStore(db);

  const supervisor = new SupervisorManager(tickets);
  app.addHook("onClose", async () => {
    for (const session of supervisor.list()) session.kill();
  });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/sessions", async () => discovery.list());

  registerAgentRoutes(app, discovery, supervisor);
  registerTicketRoutes(app, tickets);
  registerLayoutRoutes(app, layout);
  registerFsRoutes(app);
  registerSubagentRoutes(app, discovery);
  registerSessionGroupRoutes(app, sessionGroups);
  registerTicketsMcpRoute(app, tickets);
  await registerWebSocketHub(app, discovery, supervisor);

  app.get("/api/sessions/:sessionId/transcript", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { offset } = req.query as { offset?: string };
    const parsedOffset = offset ? Number.parseInt(offset, 10) : 0;

    const session = discovery.list().find((s) => s.sessionId === sessionId);
    if (!session) {
      reply.code(404);
      return { error: "unknown session" };
    }

    return readTranscriptSince(session.cwd, sessionId, Number.isFinite(parsedOffset) ? parsedOffset : 0);
  });

  const publicDir = join(__dirname, "..", "public");
  app.register(fastifyStatic, { root: publicDir });

  await app.listen({ port, host });

  const url = `http://${host}:${port}`;
  console.log(`Beacon running at ${url}`);
  if (!isLoopbackHost(host)) {
    console.log(`Non-loopback bind — bearer token required on every request:`);
    console.log(`  Authorization: Bearer ${token}`);
  }

  return { app, url };
}
