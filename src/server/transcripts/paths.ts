import { join } from "node:path";
import { CLAUDE_PROJECTS_DIR } from "../discovery/claude-home.js";
import { mangleProjectPath } from "../discovery/projects.js";

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(CLAUDE_PROJECTS_DIR, mangleProjectPath(cwd), `${sessionId}.jsonl`);
}

export function subagentTranscriptPath(
  cwd: string,
  sessionId: string,
  agentId: string,
  baseDir: string = CLAUDE_PROJECTS_DIR,
): string {
  return join(baseDir, mangleProjectPath(cwd), sessionId, "subagents", `agent-${agentId}.jsonl`);
}

export function subagentsDir(cwd: string, sessionId: string, baseDir: string = CLAUDE_PROJECTS_DIR): string {
  return join(baseDir, mangleProjectPath(cwd), sessionId, "subagents");
}
