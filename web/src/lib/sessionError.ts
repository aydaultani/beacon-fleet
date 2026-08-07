const SIGNAL_NAMES: Record<number, string> = {
  2: "SIGINT",
  9: "SIGKILL",
  15: "SIGTERM",
};

/** The Agent SDK's raw process-exit error is just "...exited with code N,"
 * which for the common case (N = 128+signal, e.g. 143 = SIGTERM) reads as
 * a cryptic number to anyone who isn't already thinking in exit codes.
 * Beacon's own dev server restarting mid-session is the single most common
 * cause on this machine right now (kills every subprocess it owns) — worth
 * naming that explicitly rather than leaving a bare code for the user to
 * puzzle over. */
export function humanizeSessionError(error: string | undefined): string | undefined {
  if (!error) return error;
  const match = error.match(/exited with code (\d+)/);
  if (!match) return error;
  const code = Number(match[1]);
  const signal = code > 128 ? SIGNAL_NAMES[code - 128] : undefined;
  if (!signal) return error;
  return `${error} (${signal} — the process was killed, most likely the Beacon server itself restarting)`;
}
