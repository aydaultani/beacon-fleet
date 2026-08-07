import { useEffect, useState, type CSSProperties } from "react";
import "./TicketLaunchOverlay.css";

export interface TicketLaunchInfo {
  title: string;
  cwd: string;
  /** Bounding rect of whatever the user clicked (dispatch button / "New
   * ticket" button) — the animation's start point. */
  origin: DOMRect;
}

const FLIGHT_MS = 620;

/** Fires once a ticket is dispatched: a small card flies from wherever the
 * user clicked toward the Fleet nav button, shrinking and fading as it
 * arrives, then calls `onDone` so the caller can switch views and select
 * the destination session — the animation is purely cosmetic, all the real
 * state transition happens after it completes. */
export function TicketLaunchOverlay({
  info,
  targetRect,
  onDone,
}: {
  info: TicketLaunchInfo | null;
  targetRect: DOMRect | null;
  onDone: () => void;
}) {
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    if (!info) return;
    setArrived(false);
    // Two rAFs: the first lets the card paint at its start position, the
    // second flips the class that triggers the CSS transition to the
    // target — a single rAF can land before the initial paint commits and
    // the card just appears already-arrived with no visible motion.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setArrived(true)));
    const timer = window.setTimeout(onDone, FLIGHT_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  if (!info) return null;

  const target = targetRect ?? info.origin;
  const style: CSSProperties = arrived
    ? {
        left: target.left + target.width / 2,
        top: target.top + target.height / 2,
        transform: "translate(-50%, -50%) scale(0.3)",
        opacity: 0,
      }
    : {
        left: info.origin.left + info.origin.width / 2,
        top: info.origin.top + info.origin.height / 2,
        transform: "translate(-50%, -50%) scale(1)",
        opacity: 1,
      };

  return (
    <div className="ticket-launch-overlay" aria-hidden="true">
      <div className="ticket-launch-card" style={style}>
        <span className="ticket-launch-card__title">{info.title}</span>
        <span className="ticket-launch-card__cwd mono">{info.cwd}</span>
      </div>
    </div>
  );
}
