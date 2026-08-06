import { homedir } from "node:os";
import { join } from "node:path";

export const CLAUDE_HOME = join(homedir(), ".claude");
export const CLAUDE_SESSIONS_DIR = join(CLAUDE_HOME, "sessions");
export const CLAUDE_JOBS_DIR = join(CLAUDE_HOME, "jobs");
export const CLAUDE_PROJECTS_DIR = join(CLAUDE_HOME, "projects");

// Deliberately not read-modify-written anywhere in this codebase: the
// running CLI rewrites this file constantly and a racing write from Beacon
// can corrupt it. Only ever read from it. See CLAUDE.md.
export const CLAUDE_CONFIG_FILE = join(homedir(), ".claude.json");
