import { join } from "node:path";
import { CLAUDE_PROJECTS_DIR } from "../discovery/claude-home.js";
import { mangleProjectPath } from "../discovery/projects.js";

export function transcriptPath(cwd: string, sessionId: string): string {
  return join(CLAUDE_PROJECTS_DIR, mangleProjectPath(cwd), `${sessionId}.jsonl`);
}

export function subagentTranscriptPath(cwd: string, sessionId: string, agentId: string): string {
  return join(CLAUDE_PROJECTS_DIR, mangleProjectPath(cwd), sessionId, "subagents", `agent-${agentId}.jsonl`);
}
