import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

export interface FsEntry {
  name: string;
  path: string;
}

export interface FsListing {
  dir: string;
  parent: string | null;
  entries: FsEntry[];
}

async function listDirectories(dir: string): Promise<FsListing> {
  const resolved = resolve(dir);
  const items = await readdir(resolved, { withFileTypes: true });
  const entries = items
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, path: join(resolved, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = dirname(resolved);
  return { dir: resolved, parent: parent === resolved ? null : parent, entries };
}

/** Directory browsing for the launch-agent path picker. Read-only, lists
 * directory names only (never file contents) — the same trust boundary
 * `POST /api/agents` already accepts an arbitrary absolute `cwd` from the
 * UI, so this exposes no new privilege. See CLAUDE.md security posture. */
export function registerFsRoutes(app: FastifyInstance): void {
  app.get("/api/fs/list", async (req, reply) => {
    const { dir } = req.query as { dir?: string };
    try {
      return await listDirectories(dir && dir.trim() ? dir : homedir());
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
