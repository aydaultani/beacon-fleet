import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTickets, type Ticket, type TicketPriority, type TicketStatus } from "../hooks/useTickets.js";
import { useSessions, type DiscoveredSession } from "../hooks/useSessions.js";
import { useAgents } from "../hooks/useAgents.js";
import { PathPicker } from "../components/PathPicker.js";
import { Dropdown } from "../components/Dropdown.js";
import { shortenCwd } from "../lib/paths.js";
import "./TicketBoard.css";

type DispatchResult = { ok: true; agentId: string; sessionId?: string } | { ok: false; error: string };

/** Fired once a dispatch actually lands an agent — lets the caller (App)
 * animate the ticket flying off toward the Fleet view and select the
 * session/agent it landed on, without TicketBoard needing to know
 * anything about the fleet view itself. */
export type TicketDispatchedHandler = (info: {
  ticket: Ticket;
  agentId: string;
  sessionId?: string;
  origin: DOMRect;
}) => void;

/** Session states that mean "actively working" for the purposes of syncing
 * a ticket's status to its assignee — mirrors the fleet tree's own busy
 * vocabulary rather than inventing a second one. */
function isActiveStatus(status: DiscoveredSession["status"]): boolean {
  return status === "busy" || status === "waiting";
}

const UNASSIGNED_VALUE = "";

function sessionLabel(session: DiscoveredSession): string {
  return `${session.name} · ${shortenCwd(session.cwd)}`;
}

/** Resolves an assignee sessionId to a human label — the live session's own
 * name/cwd when it's still around, a short "offline" fallback (matching
 * TicketCard's own offline-assignee treatment) when it isn't, or
 * "Unassigned" for no assignee at all. Shared by the session filter and
 * the search match. */
function assigneeLabel(assignee: string | null, sessions: DiscoveredSession[]): string {
  if (!assignee) return "Unassigned";
  const session = sessions.find((s) => s.sessionId === assignee);
  return session ? sessionLabel(session) : `${assignee.slice(0, 8)}… (offline)`;
}

/** A ticket's project scopes which sessions it can be assigned to — cwd
 * equal to, or nested under, the selected project directory. Keeps the
 * assignee picker from offering sessions working on unrelated projects. */
function isSessionInProject(session: DiscoveredSession, project: string): boolean {
  if (!project) return false;
  const base = project.endsWith("/") ? project.slice(0, -1) : project;
  return session.cwd === base || session.cwd.startsWith(`${base}/`);
}

const COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

const STATUS_OPTIONS: TicketStatus[] = ["open", "in_progress", "blocked", "done"];
const PRIORITY_OPTIONS: TicketPriority[] = ["low", "med", "high"];

const NEW_PATH_VALUE = "__new_path__";

// Same threshold SessionTree's node dragging uses — small enough that a
// deliberate drag registers instantly, large enough that a plain click
// (mousedown+up with a pixel or two of tremble) never gets mistaken for one.
const DRAG_THRESHOLD_PX = 4;

interface TicketDragState {
  ticket: Ticket;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  dragging: boolean;
}

/** Pointer targets a drag should never hijack — its own dropdowns, selects,
 * and buttons need normal clicks to keep working. Native HTML5
 * draggable="true" on the whole card doesn't compose with nested
 * interactive elements like this; a manual pointer-down/move/up drag (same
 * technique as SessionTree's node dragging) does, because we simply never
 * start tracking a drag when the gesture began on one of these. */
const DRAG_IGNORE_SELECTOR = "button, select, .dropdown, a, input, textarea";

export function TicketBoard({ onDispatched }: { onDispatched?: TicketDispatchedHandler }) {
  const { tickets, error, createTicket, updateTicket, deleteTicket } = useTickets();
  const { sessions } = useSessions();
  const { agentIdBySessionId, launch } = useAgents();

  const runningProjects = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.cwd))).sort((a, b) => a.localeCompare(b)),
    [sessions],
  );

  // Keep a ticket's status honest against what its assignee is actually
  // doing: once the assigned session goes busy/waiting, an "open" ticket
  // auto-advances to "in_progress". Deliberately one-directional — it never
  // touches "blocked" or "done", both of which reflect a human judgment
  // call the live session state can't make. The ref dedupes so a ticket
  // doesn't get PATCHed on every sessions/ws tick while `tickets` itself is
  // still catching up to the previous PATCH (poll interval, not push).
  const syncedRef = useRef(new Set<number>());
  useEffect(() => {
    for (const ticket of tickets) {
      if (ticket.status !== "open") {
        syncedRef.current.delete(ticket.id);
        continue;
      }
      if (!ticket.assignee || syncedRef.current.has(ticket.id)) continue;
      const session = sessions.find((s) => s.sessionId === ticket.assignee);
      if (session?.alive && isActiveStatus(session.status)) {
        syncedRef.current.add(ticket.id);
        void updateTicket(ticket.id, { status: "in_progress" });
      }
    }
  }, [tickets, sessions, updateTicket]);

  async function dispatchTicket(ticket: Ticket, origin?: DOMRect): Promise<DispatchResult> {
    const text = ticket.body ? `${ticket.title}\n\n${ticket.body}` : ticket.title;

    let agentId = ticket.assignee ? agentIdBySessionId.get(ticket.assignee) : undefined;
    // The assignee session id doubles as the destination sessionId when
    // it's already known — a freshly `launch()`ed agent won't have one
    // yet (its system/init hasn't arrived), so that case is left
    // undefined and the caller falls back to selecting by agentId instead.
    let sessionId = ticket.assignee ?? undefined;
    if (!agentId) {
      if (ticket.assignee) {
        return { ok: false, error: "Assignee isn't a Beacon-owned agent — unassign it, or pick an owned session, to dispatch." };
      }
      const launched = await launch(ticket.project);
      if (!launched.ok) return launched;
      agentId = launched.agent.id;
      sessionId = launched.agent.sessionId;
    }

    try {
      const res = await fetch(`/api/agents/${agentId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error ?? `Dispatch failed (${res.status})` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (ticket.status === "open") await updateTicket(ticket.id, { status: "in_progress" });
    if (origin) onDispatched?.({ ticket, agentId, sessionId, origin });
    return { ok: true, agentId, sessionId };
  }

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [project, setProject] = useState("");
  const [customPath, setCustomPath] = useState(false);
  // useSessions() starts empty and fills in once the initial fetch/socket
  // message lands, so don't freeze the "no running projects yet" case into
  // state at mount — fall back to the path picker only for as long as
  // there's actually nothing to pick from.
  const showCustomPath = customPath || runningProjects.length === 0;
  const [priority, setPriority] = useState<TicketPriority>("med");
  const [assignee, setAssignee] = useState(UNASSIGNED_VALUE);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const newTicketButtonRef = useRef<HTMLButtonElement | null>(null);

  // Scoped to the selected project: a ticket can only be assigned to a
  // session already working in (or under) that directory, per the same
  // rule TicketCard applies to each existing ticket's own project below.
  const assigneeOptions = useMemo(
    () =>
      sessions.filter((s) => isSessionInProject(s, project)).map((s) => ({ value: s.sessionId, label: sessionLabel(s), title: s.cwd })),
    [sessions, project],
  );

  // Changing the project can drop the currently-picked assignee out of
  // scope — the Dropdown would silently fall back to showing "Unassigned"
  // while `assignee` state still held the stale (now out-of-scope)
  // sessionId, which would then get submitted on create. Keep them in sync.
  useEffect(() => {
    if (assignee && !assigneeOptions.some((o) => o.value === assignee)) setAssignee(UNASSIGNED_VALUE);
  }, [assignee, assigneeOptions]);

  async function handleCreate() {
    if (!title.trim() || !project.trim()) return;
    setCreating(true);
    setFormError(null);
    const result = await createTicket({
      title: title.trim(),
      body: body.trim() || undefined,
      project: project.trim(),
      priority,
      assignee: assignee || null,
    });
    if (!result.ok) {
      setCreating(false);
      setFormError(result.error ?? "Failed to create ticket");
      return;
    }
    // Picking an assignee at creation time is a deliberate "send this to
    // that already-running agent now" — dispatch immediately. Leaving it
    // unassigned never launches a new agent implicitly; that stays an
    // explicit per-card Dispatch click, since spinning up a real Claude
    // Code process is not something a plain form submit should do quietly.
    if (result.ticket.assignee) {
      const origin = newTicketButtonRef.current?.getBoundingClientRect();
      const dispatched = await dispatchTicket(result.ticket, origin);
      if (!dispatched.ok) setFormError(`Ticket created, but dispatch failed: ${dispatched.error}`);
    }
    setCreating(false);
    setTitle("");
    setBody("");
    setProject("");
    setCustomPath(false);
    setAssignee(UNASSIGNED_VALUE);
  }

  // Board layout stays status-columns always — project and session are
  // filters that narrow which tickets show up in those columns (e.g. pick
  // a project and see just its open/in-progress/blocked/done breakdown),
  // not alternate groupings that replace status.
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState(UNASSIGNED_VALUE);
  const [assigneeFilter, setAssigneeFilter] = useState(UNASSIGNED_VALUE);

  const filterProjectOptions = useMemo(
    () => Array.from(new Set(tickets.map((t) => t.project))).sort((a, b) => a.localeCompare(b)),
    [tickets],
  );
  const filterAssigneeOptions = useMemo(() => {
    const assignees = Array.from(new Set(tickets.map((t) => t.assignee).filter((a): a is string => Boolean(a))));
    return assignees.sort((a, b) => assigneeLabel(a, sessions).localeCompare(assigneeLabel(b, sessions)));
  }, [tickets, sessions]);

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (projectFilter && t.project !== projectFilter) return false;
      if (assigneeFilter && t.assignee !== assigneeFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.project.toLowerCase().includes(q) ||
        assigneeLabel(t.assignee, sessions).toLowerCase().includes(q)
      );
    });
  }, [tickets, search, projectFilter, assigneeFilter, sessions]);

  const byStatus = (status: TicketStatus): Ticket[] => filteredTickets.filter((t) => t.status === status);

  const [drag, setDrag] = useState<TicketDragState | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TicketStatus | null>(null);

  function handleCardPointerDown(e: ReactPointerEvent<HTMLDivElement>, ticket: Ticket) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target instanceof HTMLElement && e.target.closest(DRAG_IGNORE_SELECTOR)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const width = e.currentTarget.getBoundingClientRect().width;
    setDrag({ ticket, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, width, dragging: false });
  }

  function handleCardPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    setDrag((prev) => {
      if (!prev || e.pointerId !== prev.pointerId) return prev;
      const dragging = prev.dragging || Math.hypot(e.clientX - prev.startX, e.clientY - prev.startY) > DRAG_THRESHOLD_PX;
      return { ...prev, x: e.clientX, y: e.clientY, dragging };
    });
    if (!drag?.dragging) return;
    // Hit-test at the pointer's actual screen position rather than trusting
    // React's dragover-style bubbling — pointer capture routes every move
    // event to the card that started the gesture, not whatever element is
    // physically under the cursor, so this is the only reliable way to know
    // which column the user is currently hovering.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const status = el?.closest<HTMLElement>("[data-ticket-status]")?.dataset.ticketStatus as TicketStatus | undefined;
    setDragOverStatus(status ?? null);
  }

  function endCardDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.dragging && dragOverStatus && dragOverStatus !== drag.ticket.status) {
      void updateTicket(drag.ticket.id, { status: dragOverStatus });
    }
    setDrag(null);
    setDragOverStatus(null);
  }

  return (
    <div className="ticket-board-wrap">
      <div className="panel-header">
        <span className="tag panel-header__tag">Tickets</span>
        <span className="panel-header__count">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="ticket-board__new-form">
        <div className="ticket-board__new">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this ticket about?" />

          {showCustomPath ? (
            <div className="ticket-board__project-field ticket-board__project-picker">
              <PathPicker value={project} onChange={setProject} placeholder="Project (absolute path)…" />
              {runningProjects.length > 0 && (
                <button
                  type="button"
                  className="ticket-board__project-back"
                  onClick={() => {
                    setCustomPath(false);
                    setProject("");
                  }}
                  title="Pick from a running project instead"
                >
                  ↩ running projects
                </button>
              )}
            </div>
          ) : (
            <Dropdown
              className="ticket-board__project-field"
              value={project}
              onChange={(v) => {
                if (v === NEW_PATH_VALUE) {
                  setCustomPath(true);
                  setProject("");
                } else {
                  setProject(v);
                }
              }}
              placeholder="Select a running project…"
              options={runningProjects.map((cwd) => ({ value: cwd, label: shortenCwd(cwd), title: cwd }))}
              extraOption={{ value: NEW_PATH_VALUE, label: "+ New path…" }}
            />
          )}

          <Dropdown
            className="ticket-board__assignee-field"
            value={assignee}
            onChange={setAssignee}
            placeholder="Unassigned"
            options={[{ value: UNASSIGNED_VALUE, label: "Unassigned" }, ...assigneeOptions]}
          />

          <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            ref={newTicketButtonRef}
            onClick={() => void handleCreate()}
            disabled={creating || !title.trim() || !project.trim()}
          >
            {creating ? "Creating…" : "New ticket"}
          </button>
        </div>
        <textarea
          className="ticket-board__new-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What do you want the agent to do?"
          rows={2}
        />
        {formError && <span className="ticket-board__form-error">{formError}</span>}
      </div>

      {error && <div className="ticket-board__error">{error}</div>}

      <div className="ticket-board__toolbar">
        <input
          className="ticket-board__search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tickets…"
        />
        <Dropdown
          className="ticket-board__filter"
          value={projectFilter}
          onChange={setProjectFilter}
          placeholder="All projects"
          options={[
            { value: UNASSIGNED_VALUE, label: "All projects" },
            ...filterProjectOptions.map((p) => ({ value: p, label: shortenCwd(p), title: p })),
          ]}
        />
        <Dropdown
          className="ticket-board__filter"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          placeholder="All sessions"
          options={[
            { value: UNASSIGNED_VALUE, label: "All sessions" },
            ...filterAssigneeOptions.map((a) => ({ value: a, label: assigneeLabel(a, sessions) })),
          ]}
        />
      </div>

      <div className="ticket-board">
        {COLUMNS.map((col) => (
          <div
            key={col.status}
            data-ticket-status={col.status}
            className={dragOverStatus === col.status ? "ticket-column ticket-column--drag-over" : "ticket-column"}
          >
            <div className="ticket-column__header">
              <span className="ticket-column__header-label">{col.label}</span>
              <span className="ticket-column__count">{byStatus(col.status).length}</span>
            </div>
            <div className="ticket-column__cards">
              {byStatus(col.status).map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  sessions={sessions}
                  assigneeSession={sessions.find((s) => s.sessionId === ticket.assignee)}
                  dragging={drag !== null && drag.dragging && drag.ticket.id === ticket.id}
                  onDragPointerDown={(e) => handleCardPointerDown(e, ticket)}
                  onDragPointerMove={handleCardPointerMove}
                  onDragPointerEnd={endCardDrag}
                  onUpdate={updateTicket}
                  onDelete={deleteTicket}
                  onDispatch={dispatchTicket}
                />
              ))}
              {byStatus(col.status).length === 0 && dragOverStatus === col.status && (
                <div className="ticket-column__drop-hint">Drop to move here</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {drag?.dragging && (
        <div
          className="ticket-drag-ghost"
          style={{ left: drag.x + 14, top: drag.y + 14, width: drag.width }}
        >
          <span className={`tag ticket-drag-ghost__priority ticket-drag-ghost__priority--${drag.ticket.priority}`}>
            {drag.ticket.priority}
          </span>
          <span className="ticket-drag-ghost__title">{drag.ticket.title}</span>
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  sessions,
  assigneeSession,
  dragging,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerEnd,
  onUpdate,
  onDelete,
  onDispatch,
}: {
  ticket: Ticket;
  /** Full live session list — scoped down to ticket.project below, same
   * rule the creation form applies while a ticket's project is still being
   * picked. */
  sessions: DiscoveredSession[];
  /** The live discovered session behind ticket.assignee, if any is currently
   * up — drives both the status dot and the dispatch button's label. */
  assigneeSession?: DiscoveredSession;
  dragging: boolean;
  onDragPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDragPointerEnd: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onUpdate: (
    id: number,
    input: Partial<Pick<Ticket, "status" | "priority" | "assignee">>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (id: number) => Promise<{ ok: boolean; error?: string }>;
  onDispatch: (ticket: Ticket, origin?: DOMRect) => Promise<DispatchResult>;
}) {
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const assigneeOptions = useMemo(
    () =>
      sessions
        .filter((s) => isSessionInProject(s, ticket.project))
        .map((s) => ({ value: s.sessionId, label: sessionLabel(s), title: s.cwd })),
    [sessions, ticket.project],
  );

  // A ticket can be assigned to a session that has since ended — keep it
  // selectable (as "(offline)") instead of silently dropping it from the list.
  const options =
    ticket.assignee && !assigneeOptions.some((o) => o.value === ticket.assignee)
      ? [{ value: ticket.assignee, label: `${ticket.assignee} (offline)` }, ...assigneeOptions]
      : assigneeOptions;

  async function handleDispatch(e: { currentTarget: HTMLElement }) {
    const origin = e.currentTarget.getBoundingClientRect();
    setDispatching(true);
    setDispatchError(null);
    const result = await onDispatch(ticket, origin);
    setDispatching(false);
    if (!result.ok) setDispatchError(result.error);
  }

  return (
    <div
      className={`ticket-card ticket-card--${ticket.priority}${dragging ? " ticket-card--dragging" : ""}`}
      onPointerDown={onDragPointerDown}
      onPointerMove={onDragPointerMove}
      onPointerUp={onDragPointerEnd}
      onPointerCancel={onDragPointerEnd}
    >
      <div className="ticket-card__title-row">
        <span className="tag ticket-card__priority-tag">{ticket.priority}</span>
        <div className="ticket-card__title">{ticket.title}</div>
      </div>
      <div className="ticket-card__project">{ticket.project}</div>
      {ticket.body && <div className="ticket-card__body">{ticket.body}</div>}
      <div className="ticket-card__assignee-row">
        {ticket.assignee && (
          <span
            className={`ticket-card__assignee-dot ticket-card__assignee-dot--${assigneeSession?.alive && isActiveStatus(assigneeSession.status) ? assigneeSession.status : "offline"}`}
            title={assigneeSession ? `${assigneeSession.status}${assigneeSession.alive ? "" : " (offline)"}` : "offline"}
          />
        )}
        <Dropdown
          className="ticket-card__assignee"
          value={ticket.assignee ?? UNASSIGNED_VALUE}
          onChange={(v) => void onUpdate(ticket.id, { assignee: v || null })}
          placeholder="Unassigned"
          options={[{ value: UNASSIGNED_VALUE, label: "Unassigned" }, ...options]}
        />
      </div>
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
        <button
          className="ticket-card__dispatch"
          onClick={(e) => void handleDispatch(e)}
          disabled={dispatching}
          title={ticket.assignee ? "Send this ticket to its assigned agent" : "Launch a new agent in this project and send it this ticket"}
        >
          {dispatching ? "…" : "▶"}
        </button>
        <button className="ticket-card__delete" onClick={() => void onDelete(ticket.id)} title="Delete">
          ✕
        </button>
      </div>
      {dispatchError && <div className="ticket-card__dispatch-error">{dispatchError}</div>}
    </div>
  );
}
