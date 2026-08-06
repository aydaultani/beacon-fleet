import { useEffect, useRef, useState } from "react";

// Mirrors src/server/discovery/types.ts DiscoveredSession. Duplicated
// rather than imported — see SessionDetail.tsx's note: web/ has its own
// tsconfig rootDir (src only) and no shared package exists yet.
export type SessionKind = "interactive" | "bg";
export type SessionStatus = "busy" | "waiting" | "idle" | "shell" | "unknown";

export interface DiscoveredSession {
  sessionId: string;
  pid: number | null;
  cwd: string;
  kind: SessionKind;
  name: string;
  status: SessionStatus;
  waitingFor?: string;
  alive: boolean;
  jobDetail?: string;
  tokens?: number;
  reconciled: boolean;
}

const POLL_INTERVAL_MS = 2000;

/** Polls GET /api/sessions. Real-time push over /ws lands here once the
 * WebSocket hub's "sessions" message type is wired into the UI layer —
 * for now this matches SessionDetail's established polling pattern. */
export function useSessions(): { sessions: DiscoveredSession[]; error: string | null } {
  const [sessions, setSessions] = useState<DiscoveredSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) throw new Error(`Failed to list sessions (${res.status})`);
        const body: DiscoveredSession[] = await res.json();
        if (!cancelled) {
          setSessions(body);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        fetchingRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { sessions, error };
}
