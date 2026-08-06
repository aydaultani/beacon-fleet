import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { registerAuthGate, isLoopbackHost } from "./auth.js";
import { DiscoveryService } from "./discovery/index.js";

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
