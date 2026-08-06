import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_JOBS_DIR } from "./claude-home.js";
import type { JobState } from "./types.js";

export interface JobStateEntry {
  short: string;
  state?: JobState;
  detail?: string;
  needs?: string;
  tokens?: number;
  name?: string;
  sessionId?: string;
  cwd?: string;
}

/**
 * Reads `~/.claude/jobs/<short8>/state.json` for every background job.
 * `pins.json` and any other stray top-level file under jobs/ is skipped —
 * only directories are job state.
 */
export async function readJobStates(): Promise<JobStateEntry[]> {
  let dirEntries: string[];
  try {
    dirEntries = await readdir(CLAUDE_JOBS_DIR, { withFileTypes: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const jobs: JobStateEntry[] = [];
  for (const short of dirEntries) {
    const statePath = join(CLAUDE_JOBS_DIR, short, "state.json");
    const entry = await readState(statePath, short);
    if (entry) jobs.push(entry);
  }
  return jobs;
}

async function readState(path: string, short: string): Promise<JobStateEntry | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<JobStateEntry>;
    return { ...parsed, short };
  } catch {
    return null;
  }
}
