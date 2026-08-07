import { useEffect, useRef, useState } from "react";

export interface SubagentSummary {
  agentId: string;
  lastActivity: number;
}

const POLL_INTERVAL_MS = 3000;

// Module-level, not per-hook-instance: every SessionRoot on the tree
// mounts its own useSubagents(), and switching groups back and forth
// remounts them repeatedly. Without this, each remount reset straight to
// an empty list and waited on a fresh round-trip before the connector
// lines to a session's subagents could even appear — a visible flash for
// data that almost certainly hadn't changed since the last time this
// exact session was on screen. Stale-while-revalidate: show the last
// known list immediately, then let the poll below (same cadence as
// before) refresh it in the background. Freshness bound is unchanged;
// this only removes the artificial wait on data already in hand.
const cache = new Map<string, SubagentSummary[]>();

/** Real Claude Code subagents (Task-tool sub-conversations) under a
 * session — see src/server/transcripts/subagents.ts. Polls rather than a
 * dedicated WS message: subagent creation is rare enough that a few
 * seconds of latency is fine, and it avoids adding another message type
 * to the /ws hub for a view that's only open when a session is selected. */
export function useSubagents(sessionId: string | null): { subagents: SubagentSummary[]; error: string | null } {
  const [subagents, setSubagents] = useState<SubagentSummary[]>(() => (sessionId ? (cache.get(sessionId) ?? []) : []));
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    setSubagents(sessionId ? (cache.get(sessionId) ?? []) : []);
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
          cache.set(sessionId, body);
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
