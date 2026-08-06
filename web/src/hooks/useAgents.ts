import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentSummary {
  id: string;
  sessionId?: string;
  cwd: string;
}

const POLL_INTERVAL_MS = 2000;

export interface UseAgentsResult {
  agents: AgentSummary[];
  /** sessionId -> Beacon-owned agent id, once known (populated after the
   * agent's system/init message arrives server-side). */
  agentIdBySessionId: Map<string, string>;
  launch: (cwd: string, model?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const fetchingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const res = await fetch("/api/agents");
        if (res.ok && !cancelled) setAgents(await res.json());
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

  const launch = useCallback(async (cwd: string, model?: string) => {
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
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const agentIdBySessionId = new Map<string, string>();
  for (const agent of agents) {
    if (agent.sessionId) agentIdBySessionId.set(agent.sessionId, agent.id);
  }

  return { agents, agentIdBySessionId, launch };
}
