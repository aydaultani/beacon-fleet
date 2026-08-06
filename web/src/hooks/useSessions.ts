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

type WsInboundMessage = { type: "sessions"; sessions: DiscoveredSession[] } | { type: "agent-event" };

const RECONNECT_DELAY_MS = 2000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Live session list pushed over /ws (the hub sends a "sessions" snapshot
 * immediately on connect, then again on every discovery update — as fast
 * as fs.watch fires server-side, not capped at a poll interval). An
 * initial GET /api/sessions covers first paint while the socket is still
 * connecting; reconnects with a fixed backoff on drop, matching
 * SessionDetail's established WS pattern.
 */
export function useSessions(): { sessions: DiscoveredSession[]; error: string | null } {
  const [sessions, setSessions] = useState<DiscoveredSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gotFirstMessageRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/sessions")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to list sessions (${res.status})`))))
      .then((body: DiscoveredSession[]) => {
        // Only use this if the socket hasn't already delivered a fresher
        // snapshot — avoids the initial fetch clobbering a newer WS push
        // that can legitimately arrive first on a fast local connection.
        if (!cancelled && !gotFirstMessageRef.current) setSessions(body);
      })
      .catch((err) => {
        if (!cancelled && !gotFirstMessageRef.current) setError(err instanceof Error ? err.message : String(err));
      });

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(wsUrl());
      socket.onmessage = (ev) => {
        let msg: WsInboundMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type !== "sessions") return;
        gotFirstMessageRef.current = true;
        setSessions(msg.sessions);
        setError(null);
      };
      socket.onclose = () => {
        if (!cancelled) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { sessions, error };
}
