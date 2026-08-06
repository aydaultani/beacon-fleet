import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Cheap liveness check via signal 0 — no permissions, no process listing.
 * `sessions/<pid>.json` files are stale-on-crash (Claude Code doesn't clean
 * them up on an unclean exit), so this check, not file mtime, is what
 * decides whether a session is actually running.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by someone else — still
    // alive from our perspective, just not signalable.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Best-effort PID-reuse guard: compares the process's actual start time
 * (via `ps`) against the `procStart` string Claude Code recorded when it
 * wrote the registry file. Only worth the ~30-80ms `ps` call before a
 * mutating action (kill, adopt) — not on every discovery tick.
 *
 * Returns true if we can't verify (no `ps`, unexpected format) rather than
 * blocking the action outright; this is a best-effort safety net, not a
 * hard guarantee, and false negatives here are worse than false positives
 * for a local single-user tool.
 */
export async function verifyProcStart(pid: number, recordedProcStart: string | undefined): Promise<boolean> {
  if (!recordedProcStart) return true;
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]);
    const actual = normalize(stdout);
    if (!actual) return false; // ps returned nothing -> pid is gone
    return actual === normalize(recordedProcStart);
  } catch {
    return true;
  }
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
