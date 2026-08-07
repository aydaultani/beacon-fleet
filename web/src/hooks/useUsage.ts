import { useEffect, useRef, useState } from "react";

// Mirrors src/server/transcripts/machine-usage.ts MachineUsageTotals.
export interface MachineUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  updatedAt: number;
}

type WsInboundMessage = { type: "usage"; usage: MachineUsageTotals } | { type: "sessions" } | { type: "agent-event" };

const RECONNECT_DELAY_MS = 2000;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Machine-wide token spend, pushed live over the same /ws hub useSessions
 * uses (server re-scans transcripts on a short interval and emits
 * "update" — see machine-usage.ts). An initial GET /api/usage covers first
 * paint while the socket connects, same pattern as useSessions.
 */
export function useUsage(): MachineUsageTotals | null {
  const [usage, setUsage] = useState<MachineUsageTotals | null>(null);
  const gotFirstMessageRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to fetch usage (${res.status})`))))
      .then((body: MachineUsageTotals) => {
        if (!cancelled && !gotFirstMessageRef.current) setUsage(body);
      })
      .catch(() => {
        // Header counter degrades to "no data yet" silently — not worth a
        // user-facing error for a secondary stat.
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
        if (msg.type !== "usage") return;
        gotFirstMessageRef.current = true;
        setUsage(msg.usage);
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

  return usage;
}
