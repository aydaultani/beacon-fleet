import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TicketsCore } from "./tickets-contract.js";

/**
 * In-process MCP server for agents Beacon itself launched. Cheap (no
 * subprocess, no network hop) but only reachable from queries Beacon
 * constructs — the config is a live JS object handle, not a socket. External
 * `claude` sessions need the standalone HTTP server (see http-server.ts).
 * See CLAUDE.md.
 */
export function createBeaconSdkMcpServer(tickets: TicketsCore): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "beacon",
    version: "1.0.0",
    instructions: "Beacon ticket tracker. Create and update tickets to track units of work in this project.",
    tools: [
      tool(
        "create_ticket",
        "Create a new Beacon ticket for a unit of work.",
        {
          title: z.string().max(120),
          body: z.string().default(""),
          priority: z.enum(["low", "med", "high"]).default("med"),
          project: z.string().describe("Absolute project directory path"),
          parentId: z.number().int().optional(),
        },
        async (args) => {
          try {
            const created = await tickets.createTicket(args);
            return {
              content: [{ type: "text", text: `Created ticket #${created.id}: ${created.title}` }],
              structuredContent: created as unknown as Record<string, unknown>,
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Could not create ticket: ${describe(err)}` }], isError: true };
          }
        },
        { annotations: { readOnlyHint: false, destructiveHint: false } },
      ),

      tool(
        "update_ticket",
        "Update an existing Beacon ticket by id.",
        {
          id: z.number().int(),
          status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
          title: z.string().optional(),
          body: z.string().optional(),
          priority: z.enum(["low", "med", "high"]).optional(),
        },
        async (args) => {
          try {
            const { id, ...rest } = args;
            const updated = await tickets.updateTicket(id, rest);
            return {
              content: [{ type: "text", text: `Ticket #${updated.id} -> ${updated.status}` }],
              structuredContent: updated as unknown as Record<string, unknown>,
            };
          } catch (err) {
            return { content: [{ type: "text", text: `Could not update ticket: ${describe(err)}` }], isError: true };
          }
        },
        { annotations: { idempotentHint: true } },
      ),

      tool(
        "list_tickets",
        "List Beacon tickets, optionally filtered by status or project.",
        {
          status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
          project: z.string().optional(),
        },
        async (args) => {
          const rows = await tickets.listTickets(args);
          const text = rows.map((r) => `#${r.id} [${r.status}] ${r.title}`).join("\n");
          return { content: [{ type: "text", text: text.length > 0 ? text : "(no tickets)" }] };
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
