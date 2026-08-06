import { useState } from "react";
import { useSessions, type DiscoveredSession, type SessionStatus } from "../hooks/useSessions.js";
import type { AgentSummary } from "../hooks/useAgents.js";
import { PathPicker } from "../components/PathPicker.js";
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

  const [launchCwd, setLaunchCwd] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // A freshly launched agent may not have a Claude session id yet (no
  // system/init message has arrived server-side) — union with discovered
  // sessions so it's still visible and selectable while starting up.
  const bySessionId = new Map<string, DiscoveredSession>(sessions.map((s) => [s.sessionId, s]));
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

        {sessions.map((session) => (
          <SessionRow
            key={session.sessionId}
            session={session}
            selected={session.sessionId === selectedSessionId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: DiscoveredSession;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <button
      className={selected ? "sidebar__row sidebar__row--selected" : "sidebar__row"}
      onClick={() => onSelect(session.sessionId)}
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
