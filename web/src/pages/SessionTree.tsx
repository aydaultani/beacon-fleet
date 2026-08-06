import { useState, type MouseEvent } from "react";
import type { DiscoveredSession, SessionStatus } from "../hooks/useSessions.js";
import { useSubagents } from "../hooks/useSubagents.js";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu.js";
import "./SessionTree.css";

export type SelectedNode =
  | { kind: "session"; sessionId: string }
  | { kind: "subagent"; sessionId: string; agentId: string };

export interface SessionTreeProps {
  sessions: DiscoveredSession[];
  agentIdBySessionId: Map<string, string>;
  selectedNode: SelectedNode | null;
  onSelectNode: (node: SelectedNode) => void;
  onAdopt: (sessionId: string) => void;
  onInterrupt: (agentId: string) => void;
  onKill: (agentId: string) => void;
  onDelegate: (agentId: string, text: string) => void;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  busy: "Busy",
  waiting: "Waiting",
  idle: "Idle",
  shell: "Shell",
  unknown: "Unknown",
};

function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function SessionTree({
  sessions,
  agentIdBySessionId,
  selectedNode,
  onSelectNode,
  onAdopt,
  onInterrupt,
  onKill,
  onDelegate,
}: SessionTreeProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [delegatePrompt, setDelegatePrompt] = useState<{ x: number; y: number; agentId: string; text: string } | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="tree tree--empty">
        <p>Select a group on the left to see its sessions and subagents.</p>
      </div>
    );
  }

  function openSessionMenu(e: MouseEvent, session: DiscoveredSession) {
    e.preventDefault();
    const agentId = agentIdBySessionId.get(session.sessionId);
    const items = agentId
      ? [
          {
            label: "Delegate to a subagent…",
            onSelect: () => setDelegatePrompt({ x: e.clientX, y: e.clientY, agentId, text: "" }),
          },
          { label: "Interrupt", onSelect: () => onInterrupt(agentId) },
          { label: "Kill", onSelect: () => onKill(agentId), danger: true },
        ]
      : [{ label: "Adopt", onSelect: () => onAdopt(session.sessionId) }];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div className="tree" onContextMenu={(e) => e.preventDefault()}>
      <div className="tree__forest">
        {sessions.map((session) => (
          <SessionRoot
            key={session.sessionId}
            session={session}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            onContextMenu={(e) => openSessionMenu(e, session)}
          />
        ))}
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      {delegatePrompt && (
        <div className="delegate-popover" style={{ left: delegatePrompt.x, top: delegatePrompt.y }}>
          <div className="delegate-popover__hint">
            Sends a prompt to this session asking it to delegate the work to a subagent — it decides whether to,
            there's no way to force a subagent to start directly.
          </div>
          <textarea
            autoFocus
            value={delegatePrompt.text}
            onChange={(e) => setDelegatePrompt({ ...delegatePrompt, text: e.target.value })}
            placeholder="e.g. Use a subagent to audit the auth module for XSS issues"
          />
          <div className="delegate-popover__actions">
            <button onClick={() => setDelegatePrompt(null)}>Cancel</button>
            <button
              className="delegate-popover__send"
              disabled={!delegatePrompt.text.trim()}
              onClick={() => {
                onDelegate(delegatePrompt.agentId, delegatePrompt.text.trim());
                setDelegatePrompt(null);
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionRoot({
  session,
  selectedNode,
  onSelectNode,
  onContextMenu,
}: {
  session: DiscoveredSession;
  selectedNode: SelectedNode | null;
  onSelectNode: (node: SelectedNode) => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const { subagents } = useSubagents(session.sessionId);
  const isRootSelected = selectedNode?.kind === "session" && selectedNode.sessionId === session.sessionId;

  return (
    <div className="tree__tree">
      <button
        className={isRootSelected ? "tree-node tree-node--selected" : "tree-node"}
        onClick={() => onSelectNode({ kind: "session", sessionId: session.sessionId })}
        onContextMenu={onContextMenu}
      >
        <span className={`tree-node__dot tree-node__dot--${session.status}`} />
        <span className="tree-node__name">{session.name}</span>
        <span className="tree-node__status">{STATUS_LABEL[session.status]}</span>
      </button>

      {subagents.length > 0 && (
        <div className="tree__children">
          <div className="tree__trunk" />
          <div className="tree__children-row">
            {subagents.map((sub) => {
              const selected = selectedNode?.kind === "subagent" && selectedNode.agentId === sub.agentId;
              return (
                <div className="tree__child-slot" key={sub.agentId}>
                  <div className="tree__branch" />
                  <button
                    className={selected ? "tree-node tree-node--child tree-node--selected" : "tree-node tree-node--child"}
                    onClick={() => onSelectNode({ kind: "subagent", sessionId: session.sessionId, agentId: sub.agentId })}
                  >
                    <span className="tree-node__name mono">agent-{sub.agentId.slice(0, 8)}</span>
                    <span className="tree-node__status">{timeAgo(sub.lastActivity)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
