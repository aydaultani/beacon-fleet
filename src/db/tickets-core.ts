import type { DatabaseSync } from "node:sqlite";
import type {
  CreateTicketInput,
  ListTicketsFilter,
  Ticket,
  TicketsCore,
  UpdateTicketInput,
} from "../server/mcp/tickets-contract.js";

interface TicketRow {
  id: number;
  title: string;
  body: string;
  status: string;
  priority: string;
  project: string;
  assignee: string | null;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
}

function rowToTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status as Ticket["status"],
    priority: row.priority as Ticket["priority"],
    project: row.project,
    assignee: row.assignee,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Implements the `TicketsCore` contract both MCP surfaces depend on
 * (`src/server/mcp/tickets-contract.ts`) against SQLite. Kept as a plain
 * class over a `DatabaseSync` handle rather than module-level functions so
 * tests can point it at an isolated `:memory:` database. */
export class SqliteTicketsCore implements TicketsCore {
  constructor(private readonly db: DatabaseSync) {}

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const now = Date.now();
    const result = this.db
      .prepare(`
        INSERT INTO tickets (title, body, status, priority, project, assignee, parent_id, created_at, updated_at)
        VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.title,
        input.body ?? "",
        input.priority ?? "med",
        input.project,
        input.assignee ?? null,
        input.parentId ?? null,
        now,
        now,
      );

    const created = await this.getTicket(Number(result.lastInsertRowid));
    if (!created) throw new Error("ticket insert did not produce a readable row");
    return created;
  }

  async updateTicket(id: number, input: UpdateTicketInput): Promise<Ticket> {
    const existing = await this.getTicket(id);
    if (!existing) throw new Error(`no such ticket #${id}`);

    // Spread semantics do the right thing at the JSON boundary: a key
    // absent from `input` leaves the existing value untouched, while a key
    // present with `null` (assignee/parentId) explicitly clears it.
    const next: Ticket = { ...existing, ...input, updatedAt: Date.now() };

    this.db
      .prepare(`
        UPDATE tickets
        SET title = ?, body = ?, status = ?, priority = ?, assignee = ?, parent_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(next.title, next.body, next.status, next.priority, next.assignee, next.parentId, next.updatedAt, id);

    return next;
  }

  async getTicket(id: number): Promise<Ticket | undefined> {
    const row = this.db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id) as TicketRow | undefined;
    return row ? rowToTicket(row) : undefined;
  }

  async listTickets(filter: ListTicketsFilter = {}): Promise<Ticket[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.project) {
      clauses.push("project = ?");
      params.push(filter.project);
    }
    if (filter.assignee) {
      clauses.push("assignee = ?");
      params.push(filter.assignee);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    // id DESC as a tiebreaker: created_at is millisecond precision, and
    // tickets created in the same tick (e.g. an agent batch-creating a few)
    // would otherwise sort in an undefined order relative to each other.
    const rows = this.db
      .prepare(`SELECT * FROM tickets ${where} ORDER BY created_at DESC, id DESC`)
      .all(...params) as unknown as TicketRow[];
    return rows.map(rowToTicket);
  }

  async deleteTicket(id: number): Promise<boolean> {
    const result = this.db.prepare(`DELETE FROM tickets WHERE id = ?`).run(id);
    return Number(result.changes) > 0;
  }
}
