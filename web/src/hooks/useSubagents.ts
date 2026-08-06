import { useEffect, useRef, useState } from "react";

export interface SubagentSummary {
  agentId: string;
  lastActivity: number;
}

const POLL_INTERVAL_MS = 3000;

/** Real Claude Code subagents (Task-tool sub-conversations) under a
 * session — see src/server/transcripts/subagents.ts. Polls rather than a
 * dedicated WS message: subagent creation is rare enough that a few
 * seconds of latency is fine, and it avoids adding another message type
 * to the /ws hub for a view that's only open when a session is selected. */
export function useSubagents(sessionId: string | null): { subagents: SubagentSummary[]; error: string | null } {
  const [subagents, setSubagents] = useState<SubagentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    setSubagents([]);
    setError(null);
    if (!sessionId) return;

    let cancelled = false;

    const poll = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/subagents`);
        if (!res.ok) {
          if (!cancelled) setError(`Failed to list subagents (${res.status})`);
          return;
        }
        const body: SubagentSummary[] = await res.json();
        if (!cancelled) {
          setSubagents(body);
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
  }, [sessionId]);

  return { subagents, error };
}
