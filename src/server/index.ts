import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { registerAuthGate, isLoopbackHost } from "./auth.js";
import { DiscoveryService } from "./discovery/index.js";
import { readTranscriptSince } from "./transcripts/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface StartServerOptions {
  port: number;
  host: string;
}

export async function startServer({ port, host }: StartServerOptions): Promise<void> {
  const app = Fastify({ logger: false });

  const token = registerAuthGate(app, host);

  const discovery = new DiscoveryService();
  await discovery.start();
  app.addHook("onClose", async () => discovery.stop());

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/sessions", async () => discovery.list());

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
}
