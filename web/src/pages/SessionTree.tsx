import { useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { DiscoveredSession, SessionStatus } from "../hooks/useSessions.js";
import type { SubagentSummary } from "../hooks/useSubagents.js";
import { useSubagents } from "../hooks/useSubagents.js";
import { useLayout, type LayoutTile } from "../hooks/useLayout.js";
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

const PULSE_STATUSES = new Set<SessionStatus>(["busy", "waiting"]);

function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

// Fixed node dimensions (CSS below matches these exactly) — needed so
// connector-line math and default grid placement can be computed without
// measuring the DOM.
const ROOT_W = 220;
const ROOT_H = 52;
const CHILD_W = 180;
const CHILD_H = 40;
const ROOT_GAP_X = 60;
const CHILD_GAP_X = 24;
const ROW_GAP_Y = 96;
const CANVAS_PADDING = 40;
const DRAG_THRESHOLD_PX = 4;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.2;
const FIT_PADDING = 60;

interface Point {
  x: number;
  y: number;
}

interface DragState {
  id: string;
  baseX: number;
  baseY: number;
  startClientX: number;
  startClientY: number;
  dx: number;
  dy: number;
}

/** Free-drag positioning shared by every node (session roots and subagent
 * children) in the whole canvas. Centralized here rather than per-node —
 * only one node can be dragged at a time app-wide, and a child's default
 * position depends on its parent's *live* position while the parent is
 * mid-drag, so both need to read from one shared source of truth. */
function useDragLayout(setTilePosition: (id: string, x: number, y: number, parentId: string | null) => void, zoom: number) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Whether the current gesture has crossed the drag threshold. A ref, not
  // state: it's read inside the setDrag updater below, which React (under
  // StrictMode) can invoke more than once per event — calling another
  // state setter from in there would be an impure updater with duplicated
  // side effects. Mutating a ref is idempotent under a double-invoke, so it
  // doesn't need its own render pass; only drag.dx/dy needs to re-render.
  const didDragRef = useRef(false);

  function resolvePos(id: string, layout: Map<string, LayoutTile>, defaultPos: Point): Point {
    if (drag && drag.id === id) {
      return { x: Math.max(0, drag.baseX + drag.dx), y: Math.max(0, drag.baseY + drag.dy) };
    }
    const stored = layout.get(id);
    return stored ? { x: stored.x, y: stored.y } : defaultPos;
  }

  function onPointerDown(id: string, e: ReactPointerEvent<HTMLElement>, currentPos: Point) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    setDrag({ id, baseX: currentPos.x, baseY: currentPos.y, startClientX: e.clientX, startClientY: e.clientY, dx: 0, dy: 0 });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    setDrag((prev) => {
      if (!prev) return prev;
      // Threshold check uses raw screen-space movement (what the user
      // actually felt with the mouse); the stored delta is converted to
      // canvas space so a node tracks the cursor 1:1 regardless of zoom.
      const screenDx = e.clientX - prev.startClientX;
      const screenDy = e.clientY - prev.startClientY;
      if (!didDragRef.current && Math.hypot(screenDx, screenDy) > DRAG_THRESHOLD_PX) didDragRef.current = true;
      return { ...prev, dx: screenDx / zoom, dy: screenDy / zoom };
    });
  }

  function endDrag() {
    setDrag((prev) => {
      if (prev && didDragRef.current) {
        setTilePosition(prev.id, Math.max(0, prev.baseX + prev.dx), Math.max(0, prev.baseY + prev.dy), null);
      }
      return null;
    });
  }

  /** Wrap a node's click handler: swallow the click the browser fires right
   * after a drag gesture (mousedown/up on the same element still fires
   * click regardless of distance moved) so dragging a node doesn't also
   * select it. */
  function guardClick(action: () => void) {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    action();
  }

  return {
    resolvePos,
    isDragging: (id: string) => drag?.id === id,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    guardClick,
  };
}

type DragApi = ReturnType<typeof useDragLayout>;

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
  const { layout, setTilePosition } = useLayout();
  const [zoom, setZoom] = useState(1);
  const dragApi = useDragLayout(setTilePosition, zoom);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [delegatePrompt, setDelegatePrompt] = useState<{ x: number; y: number; agentId: string; text: string } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  /** Zoom while keeping the point currently under (clientX, clientY) — the
   * cursor by default, the viewport center for the +/- buttons — fixed in
   * place, the standard diagram-editor zoom feel. */
  function zoomTo(nextZoomRaw: number, clientX?: number, clientY?: number) {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw));
    const container = treeRef.current;
    if (!container) {
      setZoom(nextZoom);
      return;
    }
    const rect = container.getBoundingClientRect();
    const anchorX = clientX !== undefined ? clientX - rect.left : rect.width / 2;
    const anchorY = clientY !== undefined ? clientY - rect.top : rect.height / 2;
    const canvasX = (container.scrollLeft + anchorX) / zoom;
    const canvasY = (container.scrollTop + anchorY) / zoom;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      if (!treeRef.current) return;
      treeRef.current.scrollLeft = canvasX * nextZoom - anchorX;
      treeRef.current.scrollTop = canvasY * nextZoom - anchorY;
    });
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    zoomTo(zoom * (1 - e.deltaY * 0.001), e.clientX, e.clientY);
  }

  /** Frame every node currently rendered in the pane — reads actual DOM
   * boxes (unaffected by the canvas's own scale transform) rather than
   * recomputing positions, so it works regardless of how much has been
   * dragged around. */
  function handleFit() {
    const canvas = canvasRef.current;
    const container = treeRef.current;
    if (!canvas || !container) return;
    const nodes = canvas.querySelectorAll<HTMLElement>(".tree-node");
    if (nodes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      const x = node.offsetLeft;
      const y = node.offsetTop;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + node.offsetWidth);
      maxY = Math.max(maxY, y + node.offsetHeight);
    });

    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const rect = container.getBoundingClientRect();
    const fitZoom = Math.min((rect.width - FIT_PADDING * 2) / contentW, (rect.height - FIT_PADDING * 2) / contentH, MAX_ZOOM);
    const nextZoom = Math.max(MIN_ZOOM, fitZoom);
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      if (!treeRef.current) return;
      treeRef.current.scrollLeft = minX * nextZoom - FIT_PADDING;
      treeRef.current.scrollTop = minY * nextZoom - FIT_PADDING;
    });
  }

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

  // Stable order so un-dragged trees don't jitter between grid slots when
  // the server's session order shifts between polls.
  const orderedSessions = [...sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const canvasWidth = Math.max(1600, orderedSessions.length * (ROOT_W + ROOT_GAP_X) + CANVAS_PADDING * 2 + 400);
  const canvasHeight = 1600;

  return (
    <div className="tree" onContextMenu={(e) => e.preventDefault()}>
      <div className="tree__scroll" ref={treeRef} onWheel={handleWheel}>
        <div
          className="tree__canvas"
          ref={canvasRef}
          style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}
        >
          {orderedSessions.map((session, index) => (
            <SessionRoot
              key={session.sessionId}
              session={session}
              index={index}
              layout={layout}
              dragApi={dragApi}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
              onContextMenu={(e) => openSessionMenu(e, session)}
            />
          ))}
        </div>
      </div>

      <div className="tree__zoom-controls">
        <button title="Zoom out" onClick={() => zoomTo(zoom - ZOOM_STEP)}>
          −
        </button>
        <button className="tree__zoom-level" title="Reset zoom" onClick={() => zoomTo(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button title="Zoom in" onClick={() => zoomTo(zoom + ZOOM_STEP)}>
          +
        </button>
        <button title="Fit all sessions and subagents in view" onClick={handleFit}>
          Fit
        </button>
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

function connectorPath(from: Point, fromW: number, fromH: number, to: Point, toW: number): string {
  const x1 = from.x + fromW / 2;
  const y1 = from.y + fromH;
  const x2 = to.x + toW / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function SessionRoot({
  session,
  index,
  layout,
  dragApi,
  selectedNode,
  onSelectNode,
  onContextMenu,
}: {
  session: DiscoveredSession;
  index: number;
  layout: Map<string, LayoutTile>;
  dragApi: DragApi;
  selectedNode: SelectedNode | null;
  onSelectNode: (node: SelectedNode) => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  const { subagents } = useSubagents(session.sessionId);
  const isRootSelected = selectedNode?.kind === "session" && selectedNode.sessionId === session.sessionId;

  const rootDefault: Point = { x: index * (ROOT_W + ROOT_GAP_X) + CANVAS_PADDING, y: CANVAS_PADDING };
  const rootPos = dragApi.resolvePos(session.sessionId, layout, rootDefault);

  const rowWidth = subagents.length > 0 ? subagents.length * CHILD_W + (subagents.length - 1) * CHILD_GAP_X : 0;
  const rowStartX = rootPos.x + ROOT_W / 2 - rowWidth / 2;
  const childDefaultY = rootPos.y + ROOT_H + ROW_GAP_Y;

  const children = subagents.map((sub, i) => {
    const childDefault: Point = { x: rowStartX + i * (CHILD_W + CHILD_GAP_X), y: childDefaultY };
    return { sub, pos: dragApi.resolvePos(sub.agentId, layout, childDefault) };
  });

  return (
    <>
      <svg className="tree__lines">
        {children.map(({ sub, pos }) => (
          <path key={sub.agentId} className="tree__line" d={connectorPath(rootPos, ROOT_W, ROOT_H, pos, CHILD_W)} />
        ))}
      </svg>

      <button
        className={
          isRootSelected
            ? "tree-node tree-node--selected"
            : dragApi.isDragging(session.sessionId)
              ? "tree-node tree-node--dragging"
              : "tree-node"
        }
        style={{ left: rootPos.x, top: rootPos.y }}
        onPointerDown={(e) => dragApi.onPointerDown(session.sessionId, e, rootPos)}
        onPointerMove={dragApi.onPointerMove}
        onPointerUp={dragApi.onPointerUp}
        onPointerCancel={dragApi.onPointerCancel}
        onClick={() => dragApi.guardClick(() => onSelectNode({ kind: "session", sessionId: session.sessionId }))}
        onContextMenu={onContextMenu}
      >
        <span
          className={`tree-node__dot tree-node__dot--${session.status}${PULSE_STATUSES.has(session.status) ? " pulse" : ""}`}
        />
        <span className="tree-node__name">{session.name}</span>
        <span className="tree-node__status">{STATUS_LABEL[session.status]}</span>
      </button>

      {children.map(({ sub, pos }) => (
        <SubagentNode
          key={sub.agentId}
          sub={sub}
          pos={pos}
          selected={selectedNode?.kind === "subagent" && selectedNode.agentId === sub.agentId}
          dragging={dragApi.isDragging(sub.agentId)}
          onPointerDown={(e) => dragApi.onPointerDown(sub.agentId, e, pos)}
          onPointerMove={dragApi.onPointerMove}
          onPointerUp={dragApi.onPointerUp}
          onPointerCancel={dragApi.onPointerCancel}
          onClick={() => dragApi.guardClick(() => onSelectNode({ kind: "subagent", sessionId: session.sessionId, agentId: sub.agentId }))}
        />
      ))}
    </>
  );
}

function SubagentNode({
  sub,
  pos,
  selected,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
}: {
  sub: SubagentSummary;
  pos: Point;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
}) {
  const className = selected
    ? "tree-node tree-node--child tree-node--selected"
    : dragging
      ? "tree-node tree-node--child tree-node--dragging"
      : "tree-node tree-node--child";
  return (
    <button
      className={className}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
    >
      <span className="tree-node__name mono">agent-{sub.agentId.slice(0, 8)}</span>
      <span className="tree-node__status">{timeAgo(sub.lastActivity)}</span>
    </button>
  );
}
