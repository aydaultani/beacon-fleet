export type SessionKind = "interactive" | "bg";
export type SessionStatus = "busy" | "waiting" | "idle" | "shell" | "unknown";
export type JobState = "working" | "blocked" | "done" | "unknown";

/** Where a `DiscoveredSession` record's fields were sourced from, most
 * recently updated source wins per-field during merge. */
export type DiscoverySource = "sessions-registry" | "jobs" | "cli-reconcile";

export interface DiscoveredSession {
  sessionId: string;
  pid: number | null;
  cwd: string;
  kind: SessionKind;
  name: string;
  status: SessionStatus;
  waitingFor?: string;
  /** True only after a live process(pid, 0) check succeeded this tick. */
  alive: boolean;
  sources: DiscoverySource[];
  jobId?: string;
  jobState?: JobState;
  jobDetail?: string;
  tokens?: number;
  version?: string;
  startedAt?: number;
  updatedAt?: number;
  /** Recorded process-start time, only present when sourced from the
   * sessions-registry. Required by adopt-via-resume's PID-reuse guard —
   * see discovery/liveness.ts verifyProcStart(). */
  procStart?: string;
  /** Set once a `claude agents --json --all` pass has also seen this session. */
  reconciled: boolean;
}
