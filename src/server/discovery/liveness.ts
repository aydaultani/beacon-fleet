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
 * Claude Code records `procStart` in UTC, but `ps -o lstart=` reports in
 * the system's local timezone — verified against a real process on this
 * machine (IST, UTC+5:30): recorded "08:05:26" vs `ps`'s "13:35:26" for
 * the identical process, an exact 5:30 gap. A naive string comparison (even
 * after whitespace normalization) is wrong on any machine not in UTC and
 * would ALWAYS report a mismatch there — which would have made
 * adopt-via-resume unusable outside UTC. Both are parsed to epoch millis
 * and compared numerically instead, with a small tolerance for
 * second-level rounding.
 *
 * Returns true if we can't verify (no `ps`, unparseable format) rather
 * than blocking the action outright; this is a best-effort safety net,
 * not a hard guarantee, and false negatives here are worse than false
 * positives for a local single-user tool.
 *
 * Verified on macOS: `ps -p <pid>` exits non-zero with no output for a
 * pid that no longer exists — it does not succeed with blank stdout — so
 * that case is also handled by the catch block below, failing open. This
 * function's only real discriminating power is catching a *different, live*
 * process now holding the same pid (a start-time mismatch); "pid is
 * simply gone" is `isPidAlive`'s job, and callers should check that
 * first (SupervisorManager.adopt() does).
 */
export async function verifyProcStart(pid: number, recordedProcStart: string | undefined): Promise<boolean> {
  if (!recordedProcStart) return true;

  const recordedEpoch = parseAsUtc(recordedProcStart);
  if (recordedEpoch === null) return true;

  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="]);
    const trimmed = stdout.trim();
    // Not observed in practice (ps exits non-zero for a gone pid, landing
    // in the catch below instead) but kept defensively for `ps`
    // implementations that might succeed with blank output instead.
    if (!trimmed) return false;

    // ps's output has no timezone marker and is in local time — the
    // correct interpretation for Date's local-time default.
    const actualEpoch = new Date(trimmed).getTime();
    if (Number.isNaN(actualEpoch)) return true;

    return Math.abs(actualEpoch - recordedEpoch) <= 2000;
  } catch {
    return true;
  }
}

/** Claude Code's `procStart` strings carry no timezone marker but are in
 * UTC. Appending "GMT" forces Date to parse them as UTC instead of the
 * local-time default it would otherwise assume for an unmarked string. */
function parseAsUtc(value: string): number | null {
  const epoch = new Date(`${value.trim()} GMT`).getTime();
  return Number.isNaN(epoch) ? null : epoch;
}
