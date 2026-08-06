import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { TicketsCore } from "./tickets-contract.js";

/**
 * Standalone MCP endpoint for sessions Beacon does not own. External
 * `claude` CLI processes reach this over HTTP — via a project's
 * `.mcp.json` (`{"mcpServers":{"beacon":{"type":"http","url":"http://127.0.0.1:<port>/mcp"}}}`)
 * or `claude mcp add --transport http beacon <url>` — since the in-process
 * SDK server (sdk-server.ts) is only a JS object handle reachable from
 * queries Beacon itself constructs. See CLAUDE.md.
 *
 * Stateless mode (`sessionIdGenerator: undefined`): every request gets a
 * fresh transport. Simpler and sufficient here since tool calls are
 * independent reads/writes against the same SQLite store — there's no
 * per-connection state worth keeping.
 */
export function registerTicketsMcpRoute(app: FastifyInstance, tickets: TicketsCore, routePath = "/mcp"): void {
  const server = buildMcpServer(tickets);

  app.post(routePath, async (request, reply) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => void transport.close());
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}

function buildMcpServer(tickets: TicketsCore): McpServer {
  const server = new McpServer({ name: "beacon", version: "1.0.0" });

  server.registerTool(
    "create_ticket",
    {
      description: "Create a new Beacon ticket for a unit of work.",
      inputSchema: {
        title: z.string().max(120),
        body: z.string().default(""),
        priority: z.enum(["low", "med", "high"]).default("med"),
        project: z.string().describe("Absolute project directory path"),
        parentId: z.number().int().optional(),
      },
    },
    async (args) => {
      try {
        const created = await tickets.createTicket(args);
        return { content: [{ type: "text", text: `Created ticket #${created.id}: ${created.title}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Could not create ticket: ${describe(err)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "update_ticket",
    {
      description: "Update an existing Beacon ticket by id.",
      inputSchema: {
        id: z.number().int(),
        status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        priority: z.enum(["low", "med", "high"]).optional(),
      },
    },
    async (args) => {
      try {
        const { id, ...rest } = args;
        const updated = await tickets.updateTicket(id, rest);
        return { content: [{ type: "text", text: `Ticket #${updated.id} -> ${updated.status}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Could not update ticket: ${describe(err)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_tickets",
    {
      description: "List Beacon tickets, optionally filtered by status or project.",
      inputSchema: {
        status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
        project: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const rows = await tickets.listTickets(args);
      const text = rows.map((r) => `#${r.id} [${r.status}] ${r.title}`).join("\n");
      return { content: [{ type: "text", text: text.length > 0 ? text : "(no tickets)" }] };
    },
  );

  return server;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
