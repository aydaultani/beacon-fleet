import { readFile } from "node:fs/promises";
import { CLAUDE_CONFIG_FILE } from "./claude-home.js";

/**
 * Real absolute project paths, read from `~/.claude.json`'s `projects` map.
 * This is the authoritative source for a project's real path — the
 * directory names under `~/.claude/projects/` are a lossy, non-reversible
 * mangling and must never be decoded back into a path. See CLAUDE.md.
 *
 * Read-only: this file is 58KB of state the running CLI rewrites
 * constantly. Never write to it from Beacon.
 */
export async function readKnownProjectPaths(): Promise<string[]> {
  try {
    const raw = await readFile(CLAUDE_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as { projects?: Record<string, unknown> };
    return Object.keys(parsed.projects ?? {});
  } catch {
    // Missing, unreadable, or mid-write — treat as "unknown this tick"
    // rather than failing discovery.
    return [];
  }
}

/** Forward mangling only — matches Claude Code's own encoding. Never used
 * in reverse (dir name -> path is not recoverable, see readKnownProjectPaths). */
export function mangleProjectPath(absolutePath: string): string {
  return absolutePath.replace(/[/._ ]/g, "-");
}
