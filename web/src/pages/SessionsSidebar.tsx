import { useState, type MouseEvent } from "react";
import { useSessions, type DiscoveredSession, type SessionStatus } from "../hooks/useSessions.js";
import { useSessionGroups } from "../hooks/useSessionGroups.js";
import type { AgentSummary } from "../hooks/useAgents.js";
import { PathPicker } from "../components/PathPicker.js";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu.js";
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

export interface SessionsSidebarProps {
  agents: AgentSummary[];
  launch: (cwd: string, model?: string) => Promise<{ ok: true; agent: AgentSummary } | { ok: false; error: string }>;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

export function SessionsSidebar({ agents, launch, selectedSessionId, onSelect }: SessionsSidebarProps) {
  const { sessions, error } = useSessions();
  const { groups, renameGroup, moveSessionToGroup } = useSessionGroups(sessions);

  const [launchCwd, setLaunchCwd] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const pendingAgents = agents.filter((a) => !a.sessionId);

  async function handleLaunch() {
    if (!launchCwd.trim()) return;
    setLaunching(true);
    setLaunchError(null);
    const result = await launch(launchCwd.trim());
    setLaunching(false);
    if (!result.ok) setLaunchError(result.error);
    else setLaunchCwd("");
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

      {error && <div className="sidebar__error">{error}</div>}

      <div className="sidebar__list">
        {sessions.length === 0 && pendingAgents.length === 0 && !error && (
          <div className="sidebar__empty">No sessions found on this machine yet.</div>
        )}

        {pendingAgents.map((agent) => (
          <div key={agent.id} className="sidebar__row sidebar__row--pending">
            <span className="sidebar__status-dot" />
            <div className="sidebar__row-text">
              <div className="sidebar__row-name">Starting…</div>
              <div className="sidebar__row-meta mono">{shortenCwd(agent.cwd)}</div>
            </div>
          </div>
        ))}

        {groups.map((group) => {
          const visible = liveOnly ? group.sessions.filter((s) => s.alive) : group.sessions;
          if (visible.length === 0) return null;
          return (
            <div className="sidebar__group" key={group.groupId}>
              <div className="sidebar__group-header" onContextMenu={(e) => openGroupMenu(e, group.groupId, group.name)}>
                {group.name}
              </div>
              {visible.map((session) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  selected={session.sessionId === selectedSessionId}
                  onSelect={onSelect}
                  onContextMenu={(e) => openSessionMenu(e, session, group.groupId)}
                />
              ))}
            </div>
          );
        })}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
  onContextMenu,
}: {
  session: DiscoveredSession;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  return (
    <button
      className={selected ? "sidebar__row sidebar__row--selected" : "sidebar__row"}
      onClick={() => onSelect(session.sessionId)}
      onContextMenu={onContextMenu}
    >
      <span className={`sidebar__status-dot sidebar__status-dot--${session.status}`} />
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
