import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Non-loopback binds require a bearer token generated at startup and printed
 * once. The token is never persisted to disk. Loopback binds skip auth
 * entirely — the daemon's data is only ever as safe as the local user
 * account, matching Claude Code's own trust model.
 */
export function registerAuthGate(app: FastifyInstance, host: string): string | null {
  if (isLoopbackHost(host)) return null;

  const token = randomBytes(24).toString("base64url");

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  return token;
}
