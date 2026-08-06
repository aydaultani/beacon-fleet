import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_SESSIONS_DIR } from "./claude-home.js";
import type { SessionKind, SessionStatus } from "./types.js";

export interface SessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt?: number;
  procStart?: string;
  version?: string;
  kind: SessionKind;
  entrypoint?: string;
  name?: string;
  jobId?: string;
  parkedJobId?: string;
  status?: SessionStatus;
  waitingFor?: string;
  updatedAt?: number;
}

/**
 * Reads every `~/.claude/sessions/<pid>.json` heartbeat file. Tolerant of
 * partially-written files (the CLI can be mid-write when we read) and of
 * the directory not existing yet (fresh Claude Code install).
 */
export async function readSessionRegistry(): Promise<SessionRegistryEntry[]> {
  let files: string[];
  try {
    files = await readdir(CLAUDE_SESSIONS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const entries: SessionRegistryEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const entry = await readEntry(join(CLAUDE_SESSIONS_DIR, file));
    if (entry) entries.push(entry);
  }
  return entries;
}

async function readEntry(path: string): Promise<SessionRegistryEntry | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SessionRegistryEntry>;
    if (typeof parsed.pid !== "number" || typeof parsed.sessionId !== "string" || typeof parsed.cwd !== "string") {
      return null;
    }
    return parsed as SessionRegistryEntry;
  } catch {
    return null;
  }
}
