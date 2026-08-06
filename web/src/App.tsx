import { useState } from "react";
import { SessionsSidebar } from "./pages/SessionsSidebar.js";
import { SessionTree, type SelectedNode } from "./pages/SessionTree.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { SubagentDetail } from "./pages/SubagentDetail.js";
import { TicketBoard } from "./pages/TicketBoard.js";
import { useAgents } from "./hooks/useAgents.js";
import { useSessions } from "./hooks/useSessions.js";
import { useSessionGroups } from "./hooks/useSessionGroups.js";
import "./App.css";

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
  const [view, setView] = useState<View>("fleet");

  const activeGroupId = selectedSessionId ? groupIdOf(selectedSessionId) : null;
  const groupSessions = activeGroupId ? sessions.filter((s) => groupIdOf(s.sessionId) === activeGroupId) : [];

  const selectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedNode({ kind: "session", sessionId });
  };

  const detailSession =
    selectedNode?.kind === "subagent"
      ? sessions.find((s) => s.sessionId === selectedNode.sessionId)
      : selectedNode?.kind === "session"
        ? sessions.find((s) => s.sessionId === selectedNode.sessionId)
        : undefined;
  const detailAgentId = detailSession ? agentIdBySessionId.get(detailSession.sessionId) : undefined;

  return (
    <main className="app">
      <div className="app__header">
        <button className="app__brand" onClick={() => setView("fleet")} aria-label="Go to Fleet">
          <span className="app__brand-mark" aria-hidden="true" />
          <h1 className="app__title">Beacon</h1>
        </button>
        <nav className="app__nav">
          <button className={view === "fleet" ? "app__nav-btn app__nav-btn--active" : "app__nav-btn"} onClick={() => setView("fleet")}>
            Fleet
          </button>
          <button
            className={view === "tickets" ? "app__nav-btn app__nav-btn--active" : "app__nav-btn"}
            onClick={() => setView("tickets")}
          >
            Tickets
          </button>
        </nav>
      </div>

      {view === "fleet" ? (
        <div className="app__layout">
          <div className="app__sidebar">
            <SessionsSidebar agents={agents} launch={launch} selectedSessionId={selectedSessionId} onSelect={selectSession} />
          </div>
          <div className="app__tree">
            <SessionTree
              sessions={groupSessions}
              agentIdBySessionId={agentIdBySessionId}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              onAdopt={(sessionId) => void postJson(`/api/sessions/${sessionId}/adopt`)}
              onInterrupt={(agentId) => void postJson(`/api/agents/${agentId}/interrupt`)}
              onKill={(agentId) => void postJson(`/api/agents/${agentId}/kill`)}
              onDelegate={(agentId, text) => void postJson(`/api/agents/${agentId}/prompt`, { text })}
            />
          </div>
          <div className="app__detail">
            {selectedNode?.kind === "subagent" && detailSession ? (
              <SubagentDetail sessionId={detailSession.sessionId} agentId={selectedNode.agentId} />
            ) : (
              <SessionDetail sessionId={detailSession?.sessionId} agentId={detailAgentId} />
            )}
          </div>
        </div>
      ) : (
        <div className="app__layout app__layout--single">
          <TicketBoard />
        </div>
      )}
    </main>
  );
}
