import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { JobState, SessionKind, SessionStatus } from "./types.js";

const execFileAsync = promisify(execFile);

export interface CliAgentEntry {
  id?: string;
  pid?: number;
  cwd: string;
  kind: "background" | "interactive";
  startedAt: number;
  sessionId: string;
  name: string;
  status?: SessionStatus;
  state?: JobState;
}

/**
 * Cross-checks file-based discovery against `claude agents --json --all`,
 * the CLI's own merged view of interactive + background sessions across
 * every directory. Measured ~285ms per call (spawns a node process) — call
 * this periodically (see discovery/watcher.ts), never on every fs event.
 */
export async function reconcileWithCli(claudeExecutable = process.env.BEACON_CLAUDE_BIN ?? "claude"): Promise<CliAgentEntry[]> {
  const { stdout } = await execFileAsync(claudeExecutable, ["agents", "--json", "--all"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isCliAgentEntry);
}

function isCliAgentEntry(value: unknown): value is CliAgentEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.sessionId === "string" && typeof v.cwd === "string";
}

export function mapCliKind(kind: CliAgentEntry["kind"]): SessionKind {
  return kind === "interactive" ? "interactive" : "bg";
}
