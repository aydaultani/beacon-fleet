import { useEffect, useRef, useState } from "react";
import { SessionsSidebar } from "./pages/SessionsSidebar.js";
import { SessionTree, type SelectedNode } from "./pages/SessionTree.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { SubagentDetail } from "./pages/SubagentDetail.js";
import { TicketBoard, type TicketDispatchedHandler } from "./pages/TicketBoard.js";
import { useAgents, type AgentSummary } from "./hooks/useAgents.js";
import { useSessions } from "./hooks/useSessions.js";
import { useSessionGroups } from "./hooks/useSessionGroups.js";
import { HeaderClock, TokenUsageBadge, AgentStatusSummary } from "./components/HeaderStats.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { PanelToggle } from "./components/PanelToggle.js";
import { Onboarding } from "./components/Onboarding.js";
import { Resizer } from "./components/Resizer.js";
import { TicketLaunchOverlay, type TicketLaunchInfo } from "./components/TicketLaunchOverlay.js";
import { useResizableWidth } from "./hooks/useResizableWidth.js";
import { usePersistedBoolean } from "./hooks/usePersistedBoolean.js";
import { humanizeSessionError } from "./lib/sessionError.js";
import "./App.css";

/** How long the "landed here" ring + banner stay on the destination node
 * after a ticket dispatch — long enough to register, short enough to not
 * linger and look like a permanent status indicator. */
const LANDED_HIGHLIGHT_MS = 3200;

type View = "fleet" | "tickets";

async function postJson(url: string, body?: unknown): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function App() {
  const { agents, agentIdBySessionId, launch } = useAgents();
  const { sessions } = useSessions();
  const { groupIdOf } = useSessionGroups(sessions);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  // A just-launched agent, selected the instant it exists — before it has
  // a sessionId (system/init hasn't arrived yet) and before fs.watch
  // discovery has even noticed it. Lets the detail pane go live and
  // accept prompts immediately instead of leaving the user stuck
  // staring at an unclickable "Starting…" row for a couple of seconds.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [view, setView] = useState<View>("fleet");
  const sidebar = useResizableWidth("beacon-sidebar-width", 260, 180, 480, "left");
  const detail = useResizableWidth("beacon-detail-width", 380, 280, 640, "right");
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedBoolean("beacon-sidebar-collapsed", false);
  const [detailCollapsed, setDetailCollapsed] = usePersistedBoolean("beacon-detail-collapsed", false);

  const activeGroupId = selectedSessionId ? groupIdOf(selectedSessionId) : null;
  const groupSessions = activeGroupId ? sessions.filter((s) => groupIdOf(s.sessionId) === activeGroupId) : [];

  const selectSession = (sessionId: string) => {
    setSelectedAgentId(null);
    setSelectedSessionId(sessionId);
    setSelectedNode({ kind: "session", sessionId });
  };

  const selectAgent = (agent: AgentSummary) => {
    if (agent.sessionId) {
      selectSession(agent.sessionId);
      return;
    }
    setSelectedAgentId(agent.id);
    setSelectedSessionId(null);
    setSelectedNode(null);
  };

  const pendingAgent = selectedAgentId ? agents.find((a) => a.id === selectedAgentId) : undefined;

  // Ticket-dispatch "flying to the fleet" flow: `launchInfo` drives the
  // overlay animation itself (cleared as soon as it finishes), while
  // `pendingLanding`/`landed` carry the actual destination through to
  // after the animation completes — the view switch and node selection
  // happen only once the card has visibly arrived, not the instant the
  // dispatch request resolves.
  const fleetNavRef = useRef<HTMLButtonElement | null>(null);
  const [launchInfo, setLaunchInfo] = useState<TicketLaunchInfo | null>(null);
  const [launchTargetRect, setLaunchTargetRect] = useState<DOMRect | null>(null);
  const [pendingLanding, setPendingLanding] = useState<{ agentId: string; sessionId?: string; ticketTitle: string } | null>(
    null,
  );
  const [landed, setLanded] = useState<{ sessionId?: string; agentId?: string; ticketTitle: string } | null>(null);
  const landedTimerRef = useRef<number | null>(null);

  const handleTicketDispatched: TicketDispatchedHandler = (info) => {
    setLaunchTargetRect(fleetNavRef.current?.getBoundingClientRect() ?? null);
    setLaunchInfo({ title: info.ticket.title, cwd: info.ticket.project, origin: info.origin });
    setPendingLanding({ agentId: info.agentId, sessionId: info.sessionId, ticketTitle: info.ticket.title });
  };

  function handleLaunchAnimDone() {
    setLaunchInfo(null);
    if (!pendingLanding) return;
    setView("fleet");
    if (pendingLanding.sessionId) {
      selectSession(pendingLanding.sessionId);
    } else {
      setSelectedAgentId(pendingLanding.agentId);
      setSelectedSessionId(null);
      setSelectedNode(null);
    }
    setLanded({ sessionId: pendingLanding.sessionId, agentId: pendingLanding.agentId, ticketTitle: pendingLanding.ticketTitle });
    if (landedTimerRef.current) window.clearTimeout(landedTimerRef.current);
    landedTimerRef.current = window.setTimeout(() => setLanded(null), LANDED_HIGHLIGHT_MS);
    setPendingLanding(null);
  }

  // The moment the launched agent's sessionId shows up (its system/init
  // message landed server-side), promote it to a real selection — same
  // group/tree/detail machinery as any other session from here on, no
  // separate "pending" code path to keep in sync with discovery. Also
  // carries a pending ticket-launch highlight over to the now-known
  // sessionId, so a ticket dispatched to a brand-new agent still ends up
  // highlighting the right tree node once it appears, not just the
  // placeholder pane.
  useEffect(() => {
    if (!pendingAgent?.sessionId) return;
    selectSession(pendingAgent.sessionId);
    setLanded((prev) => (prev && prev.agentId === pendingAgent.id ? { ...prev, sessionId: pendingAgent.sessionId } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAgent?.sessionId]);

  const detailSession =
    selectedNode?.kind === "subagent"
      ? sessions.find((s) => s.sessionId === selectedNode.sessionId)
      : selectedNode?.kind === "session"
        ? sessions.find((s) => s.sessionId === selectedNode.sessionId)
        : undefined;
  const detailAgentId = detailSession ? agentIdBySessionId.get(detailSession.sessionId) : pendingAgent?.id;
  const detailAgent = detailAgentId ? agents.find((a) => a.id === detailAgentId) : undefined;

  return (
    <main className="app">
      <Onboarding />
      <div className="app__header">
        <button className="app__brand" onClick={() => setView("fleet")} aria-label="Go to Fleet">
          <span className="app__brand-mark" aria-hidden="true" />
          <h1 className="app__title">Beacon</h1>
        </button>
        {view === "fleet" && (
          <PanelToggle side="left" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />
        )}
        <nav className="app__nav">
          <button
            ref={fleetNavRef}
            className={view === "fleet" ? "app__nav-btn app__nav-btn--active" : "app__nav-btn"}
            onClick={() => setView("fleet")}
          >
            Fleet
          </button>
          <button
            className={view === "tickets" ? "app__nav-btn app__nav-btn--active" : "app__nav-btn"}
            onClick={() => setView("tickets")}
          >
            Tickets
          </button>
        </nav>
        <div className="app__header-stats">
          <AgentStatusSummary />
          <TokenUsageBadge />
          {view === "fleet" && (
            <PanelToggle side="right" collapsed={detailCollapsed} onToggle={() => setDetailCollapsed((v) => !v)} />
          )}
          <HeaderClock />
          <ThemeToggle />
        </div>
      </div>

      {view === "fleet" ? (
        <div className="app__layout">
          {!sidebarCollapsed && (
            <>
              <div className="app__sidebar" style={{ width: sidebar.width }}>
                <SessionsSidebar
                  agents={agents}
                  launch={launch}
                  selectedSessionId={selectedSessionId}
                  selectedAgentId={selectedAgentId}
                  onSelect={selectSession}
                  onSelectAgent={selectAgent}
                />
              </div>
              <Resizer onPointerDown={sidebar.onPointerDown} />
            </>
          )}
          <div className="app__tree">
            {landed && (
              <div className="ticket-landed-banner">
                Sub-agent launched for ticket: <strong>{landed.ticketTitle}</strong>
              </div>
            )}
            {pendingAgent ? (
              <div className="tree tree--empty">
                {pendingAgent.ended ? (
                  <p>
                    Failed to start a session in <span className="mono">{pendingAgent.cwd}</span>.
                    <br />
                    {humanizeSessionError(pendingAgent.endError) ?? "The session ended before it finished starting."}
                  </p>
                ) : (
                  <p>
                    Starting a session in <span className="mono">{pendingAgent.cwd}</span>…
                    <br />
                    Its graph will appear here as soon as it initializes — you can already talk to it on the right.
                  </p>
                )}
              </div>
            ) : (
              <SessionTree
                sessions={groupSessions}
                agentIdBySessionId={agentIdBySessionId}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                highlightSessionId={landed?.sessionId ?? null}
                onAdopt={(sessionId) => void postJson(`/api/sessions/${sessionId}/adopt`)}
                onInterrupt={(agentId) => void postJson(`/api/agents/${agentId}/interrupt`)}
                onKill={(agentId) => void postJson(`/api/agents/${agentId}/kill`)}
                onDelegate={(agentId, text) => void postJson(`/api/agents/${agentId}/prompt`, { text })}
              />
            )}
          </div>
          {!detailCollapsed && (
            <>
              <Resizer onPointerDown={detail.onPointerDown} />
              <div className="app__detail" style={{ width: detail.width }}>
                {selectedNode?.kind === "subagent" && detailSession ? (
                  <SubagentDetail sessionId={detailSession.sessionId} agentId={selectedNode.agentId} />
                ) : (
                  <SessionDetail
                    sessionId={detailSession?.sessionId ?? pendingAgent?.sessionId}
                    agentId={detailAgentId}
                    endError={detailAgent?.ended ? (humanizeSessionError(detailAgent.endError) ?? "Session ended.") : undefined}
                  />
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="app__layout app__layout--single">
          <TicketBoard onDispatched={handleTicketDispatched} />
        </div>
      )}

      <TicketLaunchOverlay info={launchInfo} targetRect={launchTargetRect} onDone={handleLaunchAnimDone} />
    </main>
  );
}
