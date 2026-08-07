import { useState, type DragEvent, type MouseEvent } from "react";
import { useSessions, type DiscoveredSession, type SessionStatus } from "../hooks/useSessions.js";
import { useSessionGroups } from "../hooks/useSessionGroups.js";
import type { AgentSummary } from "../hooks/useAgents.js";
import { PathPicker } from "../components/PathPicker.js";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu.js";
import { ConfirmModal, type ConfirmModalState } from "../components/ConfirmModal.js";
import "./SessionsSidebar.css";

function shortenCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  busy: "Busy",
  waiting: "Waiting",
  idle: "Idle",
  shell: "Shell",
  unknown: "Unknown",
};

const PULSE_STATUSES = new Set<SessionStatus>(["busy", "waiting"]);

export interface SessionsSidebarProps {
  agents: AgentSummary[];
  launch: (cwd: string, model?: string) => Promise<{ ok: true; agent: AgentSummary } | { ok: false; error: string }>;
  selectedSessionId: string | null;
  selectedAgentId?: string | null;
  onSelect: (sessionId: string) => void;
  /** Fired the instant an agent exists — right after launch, or when a
   * still-"Starting…" row is clicked — so the detail/tree panes have
   * something to show before the session even has a sessionId yet. */
  onSelectAgent: (agent: AgentSummary) => void;
}

export function SessionsSidebar({ agents, launch, selectedSessionId, selectedAgentId, onSelect, onSelectAgent }: SessionsSidebarProps) {
  const { sessions, error } = useSessions();
  const { groups, groupIdOf, renameGroup, moveSessionToGroup } = useSessionGroups(sessions);

  const [launchCwd, setLaunchCwd] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [liveOnly, setLiveOnly] = useState(true);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [bulkAdopting, setBulkAdopting] = useState(false);
  const [bulkAdoptError, setBulkAdoptError] = useState<string | null>(null);

  const ownedSessionIds = new Set(agents.filter((a) => a.sessionId).map((a) => a.sessionId as string));

  function handleRowClick(e: MouseEvent, sessionId: string) {
    if (e.shiftKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      });
      return;
    }
    // A plain click always drops any in-progress multi-selection — shift
    // is what signals "I'm building a batch," not an accidental leftover.
    if (multiSelected.size > 0) setMultiSelected(new Set());
    onSelect(sessionId);
  }

  function clearMultiSelect() {
    setMultiSelected(new Set());
  }

  function confirmBulkAdopt() {
    const targets = Array.from(multiSelected).filter((id) => !ownedSessionIds.has(id));
    if (targets.length === 0) return;
    setConfirmModal({
      title: `Adopt ${targets.length} session${targets.length === 1 ? "" : "s"}?`,
      description: "Stops each running process and resumes it under Beacon, interrupting any in-flight work in all of them.",
      confirmLabel: "Adopt all",
      danger: true,
      onConfirm: () => void runBulkAdopt(targets),
    });
  }

  async function runBulkAdopt(targets: string[]) {
    setBulkAdopting(true);
    setBulkAdoptError(null);
    const results = await Promise.all(
      targets.map(async (sessionId) => {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/adopt`, { method: "POST" });
          return res.ok;
        } catch {
          return false;
        }
      }),
    );
    setBulkAdopting(false);
    clearMultiSelect();
    const failCount = results.filter((ok) => !ok).length;
    if (failCount > 0) setBulkAdoptError(`${failCount} of ${targets.length} failed to adopt.`);
  }

  function handleRowDragStart(e: DragEvent<HTMLButtonElement>, sessionId: string) {
    e.dataTransfer.setData("text/plain", sessionId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingSessionId(sessionId);
  }

  function handleRowDragEnd() {
    setDraggingSessionId(null);
    setDragOverGroupId(null);
  }

  function handleGroupDragOver(e: DragEvent<HTMLDivElement>, groupId: string) {
    if (!draggingSessionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverGroupId !== groupId) setDragOverGroupId(groupId);
  }

  function handleGroupDrop(e: DragEvent<HTMLDivElement>, groupId: string) {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData("text/plain") || draggingSessionId;
    setDraggingSessionId(null);
    setDragOverGroupId(null);
    if (!sessionId || groupIdOf(sessionId) === groupId) return;
    void moveSessionToGroup(sessionId, groupId);
  }

  const pendingAgents = agents.filter((a) => !a.sessionId);

  async function handleLaunch() {
    if (!launchCwd.trim()) return;
    setLaunching(true);
    setLaunchError(null);
    const result = await launch(launchCwd.trim());
    setLaunching(false);
    if (!result.ok) {
      setLaunchError(result.error);
      return;
    }
    setLaunchCwd("");
    // Select it immediately — don't make the user hunt for "Starting…" in
    // the list, and don't wait on the agent poll or fs.watch discovery
    // (either can be a couple seconds out) before there's anything to look
    // at or chat with.
    onSelectAgent(result.agent);
  }

  function openGroupMenu(e: MouseEvent, groupId: string, currentName: string) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Rename group…",
          onSelect: () => {
            const name = window.prompt("Group name", currentName);
            if (name?.trim()) void renameGroup(groupId, name.trim());
          },
        },
      ],
    });
  }

  function openSessionMenu(e: MouseEvent, session: DiscoveredSession, currentGroupId: string) {
    e.preventDefault();
    const otherGroups = groups.filter((g) => g.groupId !== currentGroupId);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...otherGroups.map((g) => ({
          label: `Move to "${g.name}"`,
          onSelect: () => void moveSessionToGroup(session.sessionId, g.groupId),
        })),
        {
          label: "Move to new group…",
          onSelect: () => {
            const name = window.prompt("New group name");
            if (!name?.trim()) return;
            const groupId = `group-${crypto.randomUUID().slice(0, 8)}`;
            void moveSessionToGroup(session.sessionId, groupId).then(() => renameGroup(groupId, name.trim()));
          },
        },
      ],
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__launch">
        <PathPicker
          value={launchCwd}
          onChange={setLaunchCwd}
          placeholder="Path to launch in…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleLaunch();
          }}
        />
        <button className="sidebar__launch-btn" onClick={() => void handleLaunch()} disabled={launching || !launchCwd.trim()}>
          {launching ? "Launching…" : "New session"}
        </button>
        {launchError && <div className="sidebar__launch-error">{launchError}</div>}
      </div>

      <label className="sidebar__filter">
        <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
        Show only live sessions
      </label>

      {multiSelected.size > 0 && (
        <div className="sidebar__bulk-bar">
          <span>{multiSelected.size} selected</span>
          <button onClick={confirmBulkAdopt} disabled={bulkAdopting}>
            {bulkAdopting ? "Adopting…" : "Adopt all"}
          </button>
          <button className="sidebar__bulk-clear" onClick={clearMultiSelect} disabled={bulkAdopting}>
            Clear
          </button>
        </div>
      )}
      {bulkAdoptError && <div className="sidebar__error">{bulkAdoptError}</div>}

      {error && <div className="sidebar__error">{error}</div>}

      <div className="sidebar__list">
        {sessions.length === 0 && pendingAgents.length === 0 && !error && (
          <div className="sidebar__empty">No sessions found on this machine yet.</div>
        )}

        {pendingAgents.map((agent) => (
          <button
            key={agent.id}
            className={
              agent.id === selectedAgentId
                ? "sidebar__row sidebar__row--pending sidebar__row--selected"
                : "sidebar__row sidebar__row--pending"
            }
            onClick={() => onSelectAgent(agent)}
          >
            <span className="sidebar__status-dot pulse" />
            <div className="sidebar__row-text">
              <div className="sidebar__row-name">Starting…</div>
              <div className="sidebar__row-meta mono">{shortenCwd(agent.cwd)}</div>
            </div>
          </button>
        ))}

        {groups.map((group) => {
          const visible = liveOnly ? group.sessions.filter((s) => s.alive) : group.sessions;
          if (visible.length === 0) return null;
          return (
            <div
              className={
                dragOverGroupId === group.groupId ? "sidebar__group sidebar__group--drag-over" : "sidebar__group"
              }
              key={group.groupId}
              onDragOver={(e) => handleGroupDragOver(e, group.groupId)}
              onDragLeave={() => setDragOverGroupId((g) => (g === group.groupId ? null : g))}
              onDrop={(e) => handleGroupDrop(e, group.groupId)}
            >
              <div
                className="sidebar__group-header"
                title={group.name}
                onContextMenu={(e) => openGroupMenu(e, group.groupId, group.name)}
              >
                {group.name.startsWith("/") ? shortenCwd(group.name) : group.name}
              </div>
              {visible.map((session) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  selected={session.sessionId === selectedSessionId}
                  dragging={session.sessionId === draggingSessionId}
                  multiSelected={multiSelected.has(session.sessionId)}
                  onClick={(e) => handleRowClick(e, session.sessionId)}
                  onContextMenu={(e) => openSessionMenu(e, session, group.groupId)}
                  onDragStart={(e) => handleRowDragStart(e, session.sessionId)}
                  onDragEnd={handleRowDragEnd}
                />
              ))}
            </div>
          );
        })}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      <ConfirmModal state={confirmModal} onClose={() => setConfirmModal(null)} />
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  dragging,
  multiSelected,
  onClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: {
  session: DiscoveredSession;
  selected: boolean;
  dragging: boolean;
  multiSelected: boolean;
  onClick: (e: MouseEvent) => void;
  onContextMenu: (e: MouseEvent) => void;
  onDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const classes = ["sidebar__row"];
  if (selected) classes.push("sidebar__row--selected");
  if (dragging) classes.push("sidebar__row--dragging");
  if (multiSelected) classes.push("sidebar__row--multi-selected");

  return (
    <button
      className={classes.join(" ")}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title="Click to open · Shift-click to select multiple"
    >
      <span className={`sidebar__row-check${multiSelected ? " sidebar__row-check--on" : ""}`} aria-hidden="true" />
      <span
        className={`sidebar__status-dot sidebar__status-dot--${session.status}${PULSE_STATUSES.has(session.status) ? " pulse" : ""}`}
      />
      <div className="sidebar__row-text">
        <div className="sidebar__row-name">
          {session.name}
          {!session.alive && <span className="sidebar__offline-badge">offline</span>}
        </div>
        <div className="sidebar__row-meta mono">{shortenCwd(session.cwd)}</div>
      </div>
      <div className="sidebar__row-status">{STATUS_LABEL[session.status]}</div>
    </button>
  );
}
