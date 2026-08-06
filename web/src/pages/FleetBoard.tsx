import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DndContext, pointerWithin, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSessions, type DiscoveredSession, type SessionStatus } from "../hooks/useSessions.js";
import type { AgentSummary } from "../hooks/useAgents.js";
import { useLayout } from "../hooks/useLayout.js";
import { PathPicker } from "../components/PathPicker.js";
import "./FleetBoard.css";

const PULSE_STATUSES = new Set<SessionStatus>(["busy", "waiting"]);

const BOARD_DROPPABLE_ID = "__board__";
const GRID_COL_WIDTH = 216;
const GRID_ROW_HEIGHT = 108;
const GRID_COLS = 4;

function defaultPosition(index: number): { x: number; y: number } {
  const safeIndex = Math.max(index, 0);
  return {
    x: 20 + (safeIndex % GRID_COLS) * GRID_COL_WIDTH,
    y: 20 + Math.floor(safeIndex / GRID_COLS) * GRID_ROW_HEIGHT,
  };
}

function shortenCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  busy: "busy",
  waiting: "waiting",
  idle: "idle",
  shell: "shell",
  unknown: "unknown",
};

/** True if `candidateAncestorId` is an ancestor of `tileId` in the current
 * layout tree — used to refuse a drop that would create a cycle (dropping
 * a tile onto its own descendant). */
function isDescendant(candidateAncestorId: string, tileId: string, parentOf: Map<string, string | null>): boolean {
  let current = parentOf.get(tileId) ?? null;
  const seen = new Set<string>();
  while (current) {
    if (current === candidateAncestorId) return true;
    if (seen.has(current)) break;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

export interface FleetBoardProps {
  agents: AgentSummary[];
  launch: (cwd: string, model?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

export function FleetBoard({ agents, launch, selectedSessionId, onSelect }: FleetBoardProps) {
  const { sessions, error } = useSessions();
  const { layout, setTilePosition } = useLayout();

  const [launchCwd, setLaunchCwd] = useState("");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Union of discovered sessions and owned-but-not-yet-discovered agents —
  // a freshly launched agent may not have a Claude session id (and
  // therefore no discovery entry) until its system/init message arrives.
  // Sorted rather than left in server response order: that order isn't
  // guaranteed stable between polls (it depends on a directory listing),
  // and any never-dragged tile's default grid position is derived from
  // its index here — an unstable order would make those tiles visibly
  // jitter between grid slots on every poll for no reason.
  const tileIds = useMemo(() => {
    const ids = new Set<string>(sessions.map((s) => s.sessionId));
    for (const agent of agents) {
      if (agent.sessionId) ids.add(agent.sessionId);
    }
    return Array.from(ids).sort();
  }, [sessions, agents]);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s])), [sessions]);

  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const id of tileIds) m.set(id, layout.get(id)?.parentTileId ?? null);
    return m;
  }, [tileIds, layout]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const id of tileIds) {
      const parent = parentOf.get(id);
      if (!parent || !tileIds.includes(parent)) continue;
      const list = m.get(parent) ?? [];
      list.push(id);
      m.set(parent, list);
    }
    return m;
  }, [tileIds, parentOf]);

  const topLevelIds = useMemo(
    () => tileIds.filter((id) => !parentOf.get(id) || !tileIds.includes(parentOf.get(id) as string)),
    [tileIds, parentOf],
  );

  function handleDragEnd(event: DragEndEvent) {
    const tileId = String(event.active.id);
    const index = topLevelIds.includes(tileId) ? topLevelIds.indexOf(tileId) : tileIds.indexOf(tileId);
    const base = layout.get(tileId) ?? defaultPosition(index);

    const overId = event.over ? String(event.over.id) : null;

    // Nesting is intentionally one level deep only: the board only ever
    // renders top-level tiles plus their direct children. Either half of
    // a 3-level chain would make tiles vanish from the UI entirely
    // (rendered neither as top-level nor as anyone's child) — nesting
    // under an already-nested tile (checked via topLevelIds.includes), or
    // nesting a tile that itself already has children (checked via
    // childrenOf). Refusing both here — rather than only in the renderer
    // — keeps the persisted layout consistent with what's shown.
    const draggedHasChildren = (childrenOf.get(tileId)?.length ?? 0) > 0;
    const canNestUnder =
      overId &&
      overId !== BOARD_DROPPABLE_ID &&
      overId !== tileId &&
      topLevelIds.includes(overId) &&
      !draggedHasChildren &&
      !isDescendant(tileId, overId, parentOf);

    if (canNestUnder) {
      // Dropped onto another (top-level) tile -> nest under it. Position
      // is kept as-is for whenever it's dragged back out onto the board.
      setTilePosition(tileId, base.x, base.y, overId);
      return;
    }

    // Dropped on empty board space, on itself, or on its own descendant
    // (refused) -> free position, no parent.
    setTilePosition(tileId, base.x + event.delta.x, base.y + event.delta.y, null);
  }

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
    <div className="fleet-board-wrap">
      <div className="fleet-board__launch">
        <PathPicker
          value={launchCwd}
          onChange={setLaunchCwd}
          placeholder="Absolute path to launch an agent in…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleLaunch();
          }}
        />
        <button className="fleet-board__launch-btn" onClick={() => void handleLaunch()} disabled={launching || !launchCwd.trim()}>
          {launching ? "Launching…" : "Launch agent"}
        </button>
        {launchError && <span className="fleet-board__launch-error">{launchError}</span>}
      </div>

      {error && <div className="fleet-board__error">{error}</div>}

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
        <Board id={BOARD_DROPPABLE_ID}>
          {topLevelIds.length === 0 && !error && <div className="fleet-board__empty">No sessions discovered yet.</div>}
          {topLevelIds.map((id, index) => (
            <Tile
              key={id}
              tileId={id}
              session={sessionById.get(id)}
              position={layout.get(id) ?? defaultPosition(index)}
              childIds={childrenOf.get(id) ?? []}
              sessionById={sessionById}
              selected={selectedSessionId === id}
              onSelect={onSelect}
            />
          ))}
        </Board>
      </DndContext>
    </div>
  );
}

function Board({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="fleet-board">
      {children}
    </div>
  );
}

interface TileProps {
  tileId: string;
  session?: DiscoveredSession;
  position: { x: number; y: number };
  childIds: string[];
  sessionById: Map<string, DiscoveredSession>;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}

function Tile({ tileId, session, position, childIds, sessionById, selected, onSelect }: TileProps) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: tileId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: tileId });

  const status = session?.status ?? "unknown";
  const alive = session?.alive ?? true;

  const style: CSSProperties = {
    left: position.x,
    top: position.y,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={[
        "fleet-tile",
        `fleet-tile--${status}`,
        !alive && "fleet-tile--offline",
        isDragging && "fleet-tile--dragging",
        isOver && "fleet-tile--drop-target",
        selected && "fleet-tile--selected",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onClick={() => onSelect(tileId)}
      {...listeners}
      {...attributes}
    >
      <div className="fleet-tile__header">
        <span
          className={`fleet-tile__status-dot fleet-tile__status-dot--${status}${PULSE_STATUSES.has(status) ? " fleet-tile__status-dot--pulse" : ""}`}
        />
        <span className="fleet-tile__name">{session?.name ?? tileId.slice(0, 8)}</span>
        {!alive && <span className="fleet-tile__badge">offline</span>}
      </div>
      <div className="fleet-tile__cwd">{session ? shortenCwd(session.cwd) : "…"}</div>
      <div className="fleet-tile__meta">
        <span>{session?.kind ?? ""}</span>
        <span>{STATUS_LABEL[status]}</span>
      </div>

      {childIds.length > 0 && (
        <div className="fleet-tile__children">
          {childIds.map((childId) => (
            <NestedTile
              key={childId}
              tileId={childId}
              session={sessionById.get(childId)}
              selected={selected && false}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NestedTile({
  tileId,
  session,
  onSelect,
}: {
  tileId: string;
  session?: DiscoveredSession;
  selected: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: tileId });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: tileId });

  const status = session?.status ?? "unknown";
  const alive = session?.alive ?? true;

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={[
        "fleet-tile-nested",
        isDragging && "fleet-tile--dragging",
        isOver && "fleet-tile--drop-target",
        !alive && "fleet-tile-nested--offline",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined, zIndex: isDragging ? 100 : undefined }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(tileId);
      }}
      {...listeners}
      {...attributes}
    >
      <span className={`fleet-tile__status-dot fleet-tile__status-dot--${status}`} />
      <span className="fleet-tile-nested__name">{session?.name ?? tileId.slice(0, 8)}</span>
      {!alive && <span className="fleet-tile__badge">offline</span>}
    </div>
  );
}
