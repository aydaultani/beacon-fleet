import { useState } from "react";
import { useTickets, type Ticket, type TicketPriority, type TicketStatus } from "../hooks/useTickets.js";
import "./TicketBoard.css";

const COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "blocked", "done"];
const PRIORITY_OPTIONS: TicketPriority[] = ["low", "med", "high"];

export function TicketBoard() {
  const { tickets, error, createTicket, updateTicket, deleteTicket } = useTickets();

  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("med");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim() || !project.trim()) return;
    setCreating(true);
    setFormError(null);
    const result = await createTicket({ title: title.trim(), project: project.trim(), priority });
    setCreating(false);
    if (!result.ok) {
      setFormError(result.error ?? "Failed to create ticket");
      return;
    }
    setTitle("");
  }

  const byStatus = (status: TicketStatus): Ticket[] => tickets.filter((t) => t.status === status);

  return (
    <div className="ticket-board-wrap">
      <div className="panel-header">
        <span className="tag panel-header__tag">Tickets</span>
        <span className="panel-header__count">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="ticket-board__new">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ticket title…" />
        <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project (absolute path)…" />
        <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button onClick={() => void handleCreate()} disabled={creating || !title.trim() || !project.trim()}>
          {creating ? "Creating…" : "New ticket"}
        </button>
        {formError && <span className="ticket-board__form-error">{formError}</span>}
      </div>

      {error && <div className="ticket-board__error">{error}</div>}

      <div className="ticket-board">
        {COLUMNS.map((col) => (
          <div key={col.status} className="ticket-column">
            <div className="ticket-column__header">
              {col.label} <span className="ticket-column__count">{byStatus(col.status).length}</span>
            </div>
            <div className="ticket-column__cards">
              {byStatus(col.status).map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} onUpdate={updateTicket} onDelete={deleteTicket} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  onUpdate,
  onDelete,
}: {
  ticket: Ticket;
  onUpdate: (id: number, input: Partial<Pick<Ticket, "status" | "priority">>) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <div className={`ticket-card ticket-card--${ticket.priority}`}>
      <div className="ticket-card__title-row">
        <span className="tag ticket-card__priority-tag">{ticket.priority}</span>
        <div className="ticket-card__title">{ticket.title}</div>
      </div>
      <div className="ticket-card__project">{ticket.project}</div>
      {ticket.body && <div className="ticket-card__body">{ticket.body}</div>}
      <div className="ticket-card__row">
        <select value={ticket.status} onChange={(e) => void onUpdate(ticket.id, { status: e.target.value as TicketStatus })}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={ticket.priority}
          onChange={(e) => void onUpdate(ticket.id, { priority: e.target.value as TicketPriority })}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button className="ticket-card__delete" onClick={() => void onDelete(ticket.id)} title="Delete">
          ✕
        </button>
      </div>
    </div>
  );
}
