import type { PointerEvent } from "react";
import "./Resizer.css";

export function Resizer({ onPointerDown }: { onPointerDown: (e: PointerEvent) => void }) {
  return <div className="resizer" onPointerDown={onPointerDown} />;
}
