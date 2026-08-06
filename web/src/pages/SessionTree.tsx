import { useState, type MouseEvent } from "react";
import type { DiscoveredSession, SessionStatus } from "../hooks/useSessions.js";
import { useSubagents } from "../hooks/useSubagents.js";
import { ContextMenu, type ContextMenuState } from "../components/ContextMenu.js";
import "./SessionTree.css";

export type SelectedNode = { kind: "session" } | { kind: "subagent"; agentId: string };

export interface SessionTreeProps {
  session: DiscoveredSession | undefined;
  agentId?: string;
  selectedNode: SelectedNode;
  onSelectNode: (node: SelectedNode) => void;
  onAdopt: () => void;
  onInterrupt: () => void;
  onKill: () => void;
  onDelegate: (text: string) => void;
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

export function SessionTree({ session, agentId, selectedNode, onSelectNode, onAdopt, onInterrupt, onKill, onDelegate }: SessionTreeProps) {
  const { subagents } = useSubagents(session?.sessionId ?? null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [delegatePrompt, setDelegatePrompt] = useState<{ x: number; y: number; text: string } | null>(null);

  if (!session) {
    return (
      <div className="tree tree--empty">
        <p>Select a session on the left to see its subagents.</p>
      </div>
    );
  }

  function openSessionMenu(e: MouseEvent) {
    e.preventDefault();
    const items = agentId
      ? [
          { label: "Delegate to a subagent…", onSelect: () => setDelegatePrompt({ x: e.clientX, y: e.clientY, text: "" }) },
          { label: "Interrupt", onSelect: onInterrupt },
          { label: "Kill", onSelect: onKill, danger: true },
        ]
      : [{ label: "Adopt", onSelect: onAdopt }];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div className="tree" onContextMenu={(e) => e.preventDefault()}>
      <div className="tree__canvas">
        <button
          className={selectedNode.kind === "session" ? "tree-node tree-node--selected" : "tree-node"}
          onClick={() => onSelectNode({ kind: "session" })}
          onContextMenu={openSessionMenu}
        >
          <span className={`tree-node__dot tree-node__dot--${session.status}`} />
          <span className="tree-node__name">{session.name}</span>
          <span className="tree-node__status">{STATUS_LABEL[session.status]}</span>
        </button>

        {subagents.length > 0 && (
          <div className="tree__children">
            <div className="tree__trunk" />
            <div className="tree__children-row">
              {subagents.map((sub) => (
                <div className="tree__child-slot" key={sub.agentId}>
                  <div className="tree__branch" />
                  <button
                    className={
                      selectedNode.kind === "subagent" && selectedNode.agentId === sub.agentId
                        ? "tree-node tree-node--child tree-node--selected"
                        : "tree-node tree-node--child"
                    }
                    onClick={() => onSelectNode({ kind: "subagent", agentId: sub.agentId })}
                  >
                    <span className="tree-node__name mono">agent-{sub.agentId.slice(0, 8)}</span>
                    <span className="tree-node__status">{timeAgo(sub.lastActivity)}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
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
                onDelegate(delegatePrompt.text.trim());
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
