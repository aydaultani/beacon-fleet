import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Drag-to-resize width for a side panel, persisted across reloads.
 * `direction` controls which way growing the panel should drag: "left"
 * panels (sidebar) grow when the handle moves right; "right" panels
 * (detail pane, anchored to the viewport's right edge) grow when the
 * handle moves left.
 */
export function useResizableWidth(storageKey: string, defaultWidth: number, min: number, max: number, direction: "left" | "right") {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored >= min && stored <= max ? stored : defaultWidth;
  });
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startXRef.current;
        const signed = direction === "left" ? delta : -delta;
        setWidth(Math.min(max, Math.max(min, startWidthRef.current + signed)));
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setWidth((current) => {
          localStorage.setItem(storageKey, String(current));
          return current;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, min, max, direction, storageKey],
  );

  return { width, onPointerDown };
}
