import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentSummary {
  id: string;
  sessionId?: string;
  cwd: string;
  /** Set once this agent's session has permanently ended — naturally,
   * killed, or a launch/runtime error (e.g. a nonexistent cwd). Persisted
   * server-side, not just a one-shot WS event, so it's still visible to a
   * client that connects or selects this agent after the failure already
   * happened. */
  ended?: boolean;
  endError?: string;
}

const POLL_INTERVAL_MS = 2000;

export interface UseAgentsResult {
  agents: AgentSummary[];
  /** sessionId -> Beacon-owned agent id, once known (populated after the
   * agent's system/init message arrives server-side). */
  agentIdBySessionId: Map<string, string>;
  launch: (cwd: string, model?: string) => Promise<{ ok: true; agent: AgentSummary } | { ok: false; error: string }>;
  /** Re-fetch the agent list immediately, bypassing the poll interval —
   * lets a caller see a just-launched agent without waiting up to 2s. */
  refresh: () => Promise<void>;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const fetchingRef = useRef(false);

  const poll = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/agents");
      if (res.ok) setAgents(await res.json());
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  const launch = useCallback(
    async (cwd: string, model?: string) => {
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, model }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false as const, error: body.error ?? `Failed (${res.status})` };
        }
        const agent: AgentSummary = await res.json();
        // Optimistic: the supervisor already has this agent by the time the
        // response returns, but the next poll tick could be up to 2s away —
        // without this, a just-launched agent has nothing to select in the
        // UI until that tick lands.
        setAgents((prev) => (prev.some((a) => a.id === agent.id) ? prev : [...prev, agent]));
        return { ok: true as const, agent };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  const agentIdBySessionId = new Map<string, string>();
  for (const agent of agents) {
    if (agent.sessionId) agentIdBySessionId.set(agent.sessionId, agent.id);
  }

  return { agents, agentIdBySessionId, launch, refresh: poll };
}
