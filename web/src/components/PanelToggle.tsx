import "./PanelToggle.css";

export function PanelToggle({
  side,
  collapsed,
  onToggle,
}: {
  side: "left" | "right";
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label =
    side === "left" ? (collapsed ? "Show sidebar" : "Hide sidebar") : (collapsed ? "Show detail panel" : "Hide detail panel");

  return (
    <button type="button" className="panel-toggle" onClick={onToggle} aria-label={label} title={label}>
      <PanelIcon side={side} open={!collapsed} />
    </button>
  );
}

function PanelIcon({ side, open }: { side: "left" | "right"; open: boolean }) {
  const colX = side === "left" ? 1.5 : 9.5;
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      {open && <rect x={colX} y="3.3" width="5" height="9.4" fill="currentColor" />}
    </svg>
  );
}
