import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_PROJECTS_DIR } from "../discovery/claude-home.js";
import { subagentTranscriptPath, subagentsDir } from "./paths.js";
import { readTranscriptAtPathSince, type TranscriptPage } from "./service.js";

export interface SubagentSummary {
  agentId: string;
  /** File mtime in ms — the closest cheap proxy for "last activity"
   * without parsing the whole transcript. */
  lastActivity: number;
}

const AGENT_FILE_RE = /^agent-(.+)\.jsonl$/;

/**
 * Real Claude Code subagents (Task-tool sub-conversations) that occurred
 * within a session — not Beacon's own owned/discovered session concept.
 * These live at
 * `~/.claude/projects/<mangled>/<sessionId>/subagents/agent-<id>.jsonl`
 * (see CLAUDE.md); there's no registry of them anywhere else, so the only
 * way to know which exist is to list the directory. No subagents (or no
 * such session yet) is the normal case, not an error.
 */
export async function listSubagents(
  cwd: string,
  sessionId: string,
  baseDir: string = CLAUDE_PROJECTS_DIR,
): Promise<SubagentSummary[]> {
  const dir = subagentsDir(cwd, sessionId, baseDir);

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries = await Promise.all(
    names.flatMap((name) => {
      const match = AGENT_FILE_RE.exec(name);
      if (!match) return [];
      const agentId = match[1] as string;
      return [stat(join(dir, name)).then((s) => ({ agentId, lastActivity: s.mtimeMs }))];
    }),
  );

  return summaries.sort((a, b) => b.lastActivity - a.lastActivity);
}

export async function readSubagentTranscriptSince(
  cwd: string,
  sessionId: string,
  agentId: string,
  offset: number,
  baseDir: string = CLAUDE_PROJECTS_DIR,
): Promise<TranscriptPage> {
  return readTranscriptAtPathSince(subagentTranscriptPath(cwd, sessionId, agentId, baseDir), offset);
}
