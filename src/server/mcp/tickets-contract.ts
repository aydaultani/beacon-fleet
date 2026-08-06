export type TicketStatus = "open" | "in_progress" | "blocked" | "done";
export type TicketPriority = "low" | "med" | "high";

export interface Ticket {
  id: number;
  title: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  project: string;
  assignee: string | null;
  parentId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTicketInput {
  title: string;
  body?: string;
  priority?: TicketPriority;
  project: string;
  assignee?: string | null;
  parentId?: number | null;
}

export interface UpdateTicketInput {
  title?: string;
  body?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee?: string | null;
  parentId?: number | null;
}

export interface ListTicketsFilter {
  status?: TicketStatus;
  project?: string;
  assignee?: string;
}

/**
 * The contract `src/db/tickets-core.ts` implements. Defined here rather
 * than imported from there so the MCP layer has zero build-time coupling
 * to the concrete SQLite module — both MCP surfaces (in-process SDK server
 * and standalone HTTP server) take a `TicketsCore` as a constructor
 * argument and don't care what backs it.
 */
export interface TicketsCore {
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  updateTicket(id: number, input: UpdateTicketInput): Promise<Ticket>;
  getTicket(id: number): Promise<Ticket | undefined>;
  listTickets(filter?: ListTicketsFilter): Promise<Ticket[]>;
  deleteTicket(id: number): Promise<boolean>;
}
