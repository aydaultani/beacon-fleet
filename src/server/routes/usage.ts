import type { FastifyInstance } from "fastify";
import type { MachineUsageTracker } from "../transcripts/machine-usage.js";

/** Machine-wide token spend for the header counter — see machine-usage.ts. */
export function registerUsageRoutes(app: FastifyInstance, usage: MachineUsageTracker): void {
  app.get("/api/usage", async () => usage.getTotals());
}
