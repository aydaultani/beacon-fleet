import { useState } from "react";
import { FleetBoard } from "./pages/FleetBoard.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { TicketBoard } from "./pages/TicketBoard.js";
import { useAgents } from "./hooks/useAgents.js";
import "./App.css";

type View = "fleet" | "tickets";

export function App() {
  const { agents, agentIdBySessionId, launch } = useAgents();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [view, setView] = useState<View>("fleet");

  return (
    <main className="app">
      <div className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          <h1 className="app__title">Beacon</h1>
        </div>
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
          <div className="app__board">
            <FleetBoard agents={agents} launch={launch} selectedSessionId={selectedSessionId} onSelect={setSelectedSessionId} />
          </div>
          <div className="app__detail">
            <SessionDetail
              sessionId={selectedSessionId ?? undefined}
              agentId={selectedSessionId ? agentIdBySessionId.get(selectedSessionId) : undefined}
            />
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
