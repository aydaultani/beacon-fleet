import { useCallback, useState } from "react";
import { SessionsSidebar } from "./pages/SessionsSidebar.js";
import { SessionTree, type SelectedNode } from "./pages/SessionTree.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { SubagentDetail } from "./pages/SubagentDetail.js";
import { TicketBoard } from "./pages/TicketBoard.js";
import { useAgents } from "./hooks/useAgents.js";
import { useSessions } from "./hooks/useSessions.js";
import "./App.css";

type View = "fleet" | "tickets";

export function App() {
  const { agents, agentIdBySessionId, launch } = useAgents();
  const { sessions } = useSessions();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({ kind: "session" });
  const [view, setView] = useState<View>("fleet");

  const session = sessions.find((s) => s.sessionId === selectedSessionId);
  const agentId = selectedSessionId ? agentIdBySessionId.get(selectedSessionId) : undefined;

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedNode({ kind: "session" });
  }, []);

  const sendPrompt = useCallback(
    async (text: string) => {
      if (!agentId) return;
      await fetch(`/api/agents/${agentId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    },
    [agentId],
  );

  const adoptSession = useCallback(async () => {
    if (!selectedSessionId) return;
    await fetch(`/api/sessions/${selectedSessionId}/adopt`, { method: "POST" });
  }, [selectedSessionId]);

  const interruptSession = useCallback(async () => {
    if (!agentId) return;
    await fetch(`/api/agents/${agentId}/interrupt`, { method: "POST" });
  }, [agentId]);

  const killSession = useCallback(async () => {
    if (!agentId) return;
    await fetch(`/api/agents/${agentId}/kill`, { method: "POST" });
  }, [agentId]);

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
              session={session}
              agentId={agentId}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              onAdopt={() => void adoptSession()}
              onInterrupt={() => void interruptSession()}
              onKill={() => void killSession()}
              onDelegate={(text) => void sendPrompt(text)}
            />
          </div>
          <div className="app__detail">
            {selectedNode.kind === "subagent" && session ? (
              <SubagentDetail sessionId={session.sessionId} agentId={selectedNode.agentId} />
            ) : (
              <SessionDetail sessionId={selectedSessionId ?? undefined} agentId={agentId} />
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
