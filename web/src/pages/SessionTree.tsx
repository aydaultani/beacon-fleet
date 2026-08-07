import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
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
  /** A session root just landed on from the ticket-dispatch flying-card
   * animation — briefly rings it so "this is the sub-agent we launched for
   * that ticket" is unambiguous, not just implied by selection. */
  highlightSessionId?: string | null;
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
// Subagents only ever extend one row below their root (never stacked
// deeper), so this is a fixed, safe height for one full grid row —
// letting default placement wrap into a row/column grid without needing
// to know each session's actual subagent count ahead of time.
const GRID_ROW_H = ROOT_H + ROW_GAP_Y + CHILD_H;
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
  /** Every node moving together — just [id] for a normal single-node
   * drag, or the whole marquee selection when dragging any member of a
   * multi-selected group. */
  ids: string[];
  basePositions: Map<string, Point>;
  startClientX: number;
  startClientY: number;
  dx: number;
  dy: number;
}

/** Free-drag positioning shared by every node (session roots and subagent
 * children) in the whole canvas. Centralized here rather than per-node —
 * only one *group* can be dragged at a time app-wide, and a child's
 * default position depends on its parent's *live* position while the
 * parent is mid-drag, so both need to read from one shared source of
 * truth. `measurePositions` reads real DOM boxes (offsetLeft/offsetTop,
 * unaffected by the canvas's CSS `scale` transform) rather than
 * recomputing each node's position formula here — same technique the
 * existing "Fit" button already uses. */
function useDragLayout(
  setTilePosition: (id: string, x: number, y: number, parentId: string | null) => void,
  zoom: number,
  measurePositions: (ids: string[]) => Map<string, Point>,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Whether the current gesture has crossed the drag threshold. A ref, not
  // state: it's read inside the setDrag updater below, which React (under
  // StrictMode) can invoke more than once per event — calling another
  // state setter from in there would be an impure updater with duplicated
  // side effects. Mutating a ref is idempotent under a double-invoke, so it
  // doesn't need its own render pass; only drag.dx/dy needs to re-render.
  const didDragRef = useRef(false);

  function resolvePos(id: string, layout: Map<string, LayoutTile>, defaultPos: Point): Point {
    if (drag) {
      const base = drag.basePositions.get(id);
      if (base) return { x: Math.max(0, base.x + drag.dx), y: Math.max(0, base.y + drag.dy) };
    }
    const stored = layout.get(id);
    return stored ? { x: stored.x, y: stored.y } : defaultPos;
  }

  /** `groupIds` is every id that should move together — pass just `[id]`
   * for a plain single-node drag, or the full multi-selection when the
   * grabbed node is part of one. */
  function onPointerDown(id: string, e: ReactPointerEvent<HTMLElement>, currentPos: Point, groupIds: string[] = [id]) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    const ids = groupIds.includes(id) ? groupIds : [id];
    const basePositions = measurePositions(ids);
    // The grabbed node's own position is authoritative even if the DOM
    // measurement raced a re-render — everything else in the group still
    // moves relative to its own measured position, so the group doesn't
    // visibly shear.
    basePositions.set(id, currentPos);
    setDrag({ ids, basePositions, startClientX: e.clientX, startClientY: e.clientY, dx: 0, dy: 0 });
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
        for (const id of prev.ids) {
          const base = prev.basePositions.get(id);
          if (base) setTilePosition(id, Math.max(0, base.x + prev.dx), Math.max(0, base.y + prev.dy), null);
        }
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
    isDragging: (id: string) => drag?.ids.includes(id) ?? false,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    guardClick,
  };
}

type DragApi = ReturnType<typeof useDragLayout>;

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeRect(startX: number, startY: number, curX: number, curY: number): MarqueeRect {
  return {
    x: Math.min(startX, curX),
    y: Math.min(startY, curY),
    width: Math.abs(curX - startX),
    height: Math.abs(curY - startY),
  };
}

function rectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function SessionTree({
  sessions,
  agentIdBySessionId,
  selectedNode,
  onSelectNode,
  highlightSessionId,
  onAdopt,
  onInterrupt,
  onKill,
  onDelegate,
}: SessionTreeProps) {
  const { layout, setTilePosition } = useLayout();
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [delegatePrompt, setDelegatePrompt] = useState<{ x: number; y: number; agentId: string; text: string } | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  /** Reads each requested node's real, current on-screen box
   * (offsetLeft/offsetTop are relative to the canvas's own layout, so
   * they're unaffected by the canvas's CSS `scale(zoom)` transform) —
   * used both to seed a group drag's base positions and to test which
   * nodes a marquee rectangle actually covers. */
  function measurePositions(ids: string[]): Map<string, Point> {
    const wanted = new Set(ids);
    const result = new Map<string, Point>();
    const canvas = canvasRef.current;
    if (!canvas) return result;
    canvas.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
      const id = el.dataset.nodeId;
      if (id && wanted.has(id)) result.set(id, { x: el.offsetLeft, y: el.offsetTop });
    });
    return result;
  }

  const dragApi = useDragLayout(setTilePosition, zoom, measurePositions);

  // Marquee (rubber-band) multi-select — drag a rectangle over empty
  // canvas space, like a Mac screenshot selection or Figma, to select
  // several nodes at once and then drag any one of them to move the
  // whole group together.
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const marqueeDraggedRef = useRef(false);

  function canvasLocalPoint(e: ReactPointerEvent<HTMLElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  // Nodes call stopPropagation() in their own onPointerDown, so this only
  // ever fires for a press that started on empty canvas space.
  function handleCanvasPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    marqueeDraggedRef.current = false;
    const { x, y } = canvasLocalPoint(e);
    setMarquee({ startX: x, startY: y, curX: x, curY: y });
  }

  function handleCanvasPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!marquee) return;
    const { x, y } = canvasLocalPoint(e);
    if (!marqueeDraggedRef.current && Math.hypot(x - marquee.startX, y - marquee.startY) * zoom > DRAG_THRESHOLD_PX) {
      marqueeDraggedRef.current = true;
    }
    setMarquee((prev) => (prev ? { ...prev, curX: x, curY: y } : prev));
  }

  function handleCanvasPointerUp() {
    if (!marquee) return;
    if (!marqueeDraggedRef.current) {
      // A plain click on empty canvas — deselect rather than select
      // nothing, matching how clicking empty space works in Figma etc.
      setMultiSelected(new Set());
      setMarquee(null);
      return;
    }
    const rect = normalizeRect(marquee.startX, marquee.startY, marquee.curX, marquee.curY);
    const canvas = canvasRef.current;
    const hit = new Set<string>();
    if (canvas) {
      canvas.querySelectorAll<HTMLElement>("[data-node-id]").forEach((el) => {
        const id = el.dataset.nodeId;
        if (!id) return;
        const box: MarqueeRect = { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
        if (rectsIntersect(rect, box)) hit.add(id);
      });
    }
    setMultiSelected(hit);
    setMarquee(null);
  }

  // Default node placement wraps into this many columns before starting a
  // new row — measured from the actual pane so "everything visible on
  // load" adapts to whatever width the sidebar/detail resize leaves it,
  // instead of a single ever-widening horizontal strip that always needs
  // horizontal scrolling once there are more than a handful of sessions.
  // useLayoutEffect (not useEffect) so the first real measurement lands
  // before paint — no visible jump from a fallback size to the real one.
  const [paneSize, setPaneSize] = useState({ width: 900, height: 600 });
  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const measure = () => setPaneSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  /** Plain scroll pans the canvas (native browser scroll — `.tree__scroll`
   * is just `overflow: auto`, nothing to do here). Cmd (Mac) / Ctrl
   * (Windows/Linux) + scroll zooms instead, checked via `metaKey ||
   * ctrlKey` so one check covers both platforms without sniffing the OS —
   * trackpad pinch-to-zoom gestures also arrive as wheel events with
   * `ctrlKey: true`, so pinch zooms too for free. */
  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey) return;
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

  // Wrap, don't stack: fit as many root columns as the pane's actual width
  // allows, then start a new row below rather than growing the canvas
  // wider and wider. Only once there are more rows than the pane is tall
  // does this fall back to (vertical) scrolling — the "extreme case".
  const columns = Math.max(1, Math.floor((paneSize.width - CANVAS_PADDING * 2 + ROOT_GAP_X) / (ROOT_W + ROOT_GAP_X)));
  const rows = Math.ceil(orderedSessions.length / columns);
  const gridWidth = columns * (ROOT_W + ROOT_GAP_X) - ROOT_GAP_X + CANVAS_PADDING * 2;
  const gridHeight = rows * (GRID_ROW_H + ROW_GAP_Y) - ROW_GAP_Y + CANVAS_PADDING * 2;
  const canvasWidth = Math.max(paneSize.width, gridWidth);
  const canvasHeight = Math.max(paneSize.height, gridHeight);

  return (
    <div className="tree" onContextMenu={(e) => e.preventDefault()}>
      <div className="tree__scroll" ref={treeRef} onWheel={handleWheel}>
        <div
          className="tree__canvas"
          ref={canvasRef}
          style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
        >
          {orderedSessions.map((session, index) => (
            <SessionRoot
              key={session.sessionId}
              session={session}
              index={index}
              columns={columns}
              layout={layout}
              dragApi={dragApi}
              selectedNode={selectedNode}
              onSelectNode={onSelectNode}
              onContextMenu={(e) => openSessionMenu(e, session)}
              multiSelected={multiSelected}
              highlighted={session.sessionId === highlightSessionId}
            />
          ))}

          {marquee &&
            marqueeDraggedRef.current &&
            (() => {
              const r = normalizeRect(marquee.startX, marquee.startY, marquee.curX, marquee.curY);
              return <div className="tree__marquee" style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />;
            })()}
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
  columns,
  layout,
  dragApi,
  selectedNode,
  onSelectNode,
  onContextMenu,
  multiSelected,
  highlighted,
}: {
  session: DiscoveredSession;
  index: number;
  columns: number;
  layout: Map<string, LayoutTile>;
  dragApi: DragApi;
  selectedNode: SelectedNode | null;
  onSelectNode: (node: SelectedNode) => void;
  onContextMenu: (e: MouseEvent) => void;
  multiSelected: Set<string>;
  highlighted: boolean;
}) {
  const { subagents } = useSubagents(session.sessionId);
  const isRootSelected = selectedNode?.kind === "session" && selectedNode.sessionId === session.sessionId;
  const groupIds = multiSelected.has(session.sessionId) ? Array.from(multiSelected) : [session.sessionId];

  // Row-major grid wrap instead of one ever-widening horizontal line —
  // every root after the last column starts a new row below rather than
  // pushing the canvas wider, so the whole fleet stays visible without
  // horizontal scrolling in the common case.
  const col = index % columns;
  const row = Math.floor(index / columns);
  const rootDefault: Point = {
    x: col * (ROOT_W + ROOT_GAP_X) + CANVAS_PADDING,
    y: row * (GRID_ROW_H + ROW_GAP_Y) + CANVAS_PADDING,
  };
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
        data-node-id={session.sessionId}
        className={[
          "tree-node",
          isRootSelected && "tree-node--selected",
          !isRootSelected && multiSelected.has(session.sessionId) && "tree-node--multi-selected",
          dragApi.isDragging(session.sessionId) && "tree-node--dragging",
          highlighted && "tree-node--launch-highlight",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ left: rootPos.x, top: rootPos.y }}
        onPointerDown={(e) => dragApi.onPointerDown(session.sessionId, e, rootPos, groupIds)}
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

      {children.map(({ sub, pos }) => {
        const childGroupIds = multiSelected.has(sub.agentId) ? Array.from(multiSelected) : [sub.agentId];
        return (
          <SubagentNode
            key={sub.agentId}
            sub={sub}
            pos={pos}
            selected={selectedNode?.kind === "subagent" && selectedNode.agentId === sub.agentId}
            multiSelected={multiSelected.has(sub.agentId)}
            dragging={dragApi.isDragging(sub.agentId)}
            onPointerDown={(e) => dragApi.onPointerDown(sub.agentId, e, pos, childGroupIds)}
            onPointerMove={dragApi.onPointerMove}
            onPointerUp={dragApi.onPointerUp}
            onPointerCancel={dragApi.onPointerCancel}
            onClick={() => dragApi.guardClick(() => onSelectNode({ kind: "subagent", sessionId: session.sessionId, agentId: sub.agentId }))}
          />
        );
      })}
    </>
  );
}

function SubagentNode({
  sub,
  pos,
  selected,
  multiSelected,
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
  multiSelected: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
}) {
  const className = [
    "tree-node",
    "tree-node--child",
    selected && "tree-node--selected",
    !selected && multiSelected && "tree-node--multi-selected",
    dragging && "tree-node--dragging",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      data-node-id={sub.agentId}
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
