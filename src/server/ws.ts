import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import type { DiscoveryService } from "./discovery/index.js";
import type { DiscoveredSession } from "./discovery/index.js";
import type { SupervisorManager, BeaconSessionEvent } from "./supervisor/index.js";
import type { MachineUsageTracker, MachineUsageTotals } from "./transcripts/machine-usage.js";

export type WsOutboundMessage =
  | { type: "sessions"; sessions: DiscoveredSession[] }
  | { type: "agent-event"; agentId: string; event: BeaconSessionEvent }
  | { type: "usage"; usage: MachineUsageTotals };

/**
 * Single fan-out channel for everything the browser needs pushed live:
 * discovery updates (any session, anywhere) and owned-agent events
 * (messages, permission requests, close). One connection, tagged
 * messages — simpler than one socket per concern for a single-user local
 * dashboard.
 */
export async function registerWebSocketHub(
  app: FastifyInstance,
  discovery: DiscoveryService,
  supervisor: SupervisorManager,
  machineUsage: MachineUsageTracker,
): Promise<void> {
  await app.register(websocketPlugin);

  const sockets = new Set<WebSocket>();

  const broadcast = (message: WsOutboundMessage): void => {
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  };

  discovery.on("update", (sessions: DiscoveredSession[]) => broadcast({ type: "sessions", sessions }));
  supervisor.onEvent = (agentId, event) => broadcast({ type: "agent-event", agentId, event });
  machineUsage.on("update", (usage: MachineUsageTotals) => broadcast({ type: "usage", usage }));

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "sessions", sessions: discovery.list() } satisfies WsOutboundMessage));
    socket.send(JSON.stringify({ type: "usage", usage: machineUsage.getTotals() } satisfies WsOutboundMessage));
    socket.on("close", () => sockets.delete(socket));
  });
}
