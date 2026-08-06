import { useState } from "react";
import { FleetBoard } from "./pages/FleetBoard.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { useAgents } from "./hooks/useAgents.js";
import "./App.css";

export function App() {
  const { agents, agentIdBySessionId, launch } = useAgents();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  return (
    <main className="app">
      <h1 className="app__title">Beacon</h1>
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
    </main>
  );
}
