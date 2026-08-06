import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import type { DiscoveryService } from "./discovery/index.js";
import type { DiscoveredSession } from "./discovery/index.js";
import type { SupervisorManager, BeaconSessionEvent } from "./supervisor/index.js";

export type WsOutboundMessage =
  | { type: "sessions"; sessions: DiscoveredSession[] }
  | { type: "agent-event"; agentId: string; event: BeaconSessionEvent };

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

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    const snapshot: WsOutboundMessage = { type: "sessions", sessions: discovery.list() };
    socket.send(JSON.stringify(snapshot));
    socket.on("close", () => sockets.delete(socket));
  });
}
