import type { FastifyInstance } from "fastify";
import type { CreateTicketInput, TicketsCore, TicketStatus, UpdateTicketInput } from "../mcp/tickets-contract.js";

export function registerTicketRoutes(app: FastifyInstance, tickets: TicketsCore): void {
  app.get("/api/tickets", async (req) => {
    const { status, project, assignee } = req.query as { status?: TicketStatus; project?: string; assignee?: string };
    return tickets.listTickets({ status, project, assignee });
  });

  app.get("/api/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await tickets.getTicket(Number(id));
    if (!ticket) {
      reply.code(404);
      return { error: "unknown ticket" };
    }
    return ticket;
  });

  app.post("/api/tickets", async (req, reply) => {
    const body = req.body as Partial<CreateTicketInput> | undefined;
    if (!body?.title || !body?.project) {
      reply.code(400);
      return { error: "title and project are required" };
    }
    const created = await tickets.createTicket(body as CreateTicketInput);
    reply.code(201);
    return created;
  });

  app.patch("/api/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as UpdateTicketInput | undefined;
    try {
      return await tickets.updateTicket(Number(id), body ?? {});
    } catch (err) {
      reply.code(404);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.delete("/api/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await tickets.deleteTicket(Number(id));
    if (!deleted) {
      reply.code(404);
      return { error: "unknown ticket" };
    }
    return { ok: true };
  });
}
