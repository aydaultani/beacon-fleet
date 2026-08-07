import { useEffect, useRef, useState } from "react";

/**
 * Tweens a displayed number toward `target` instead of snapping — used for
 * the header token counter so live updates read as a subtle count-up
 * rather than a jarring digit swap. Always starts the next tween from
 * whatever is currently on screen (tracked in `displayRef`, updated every
 * frame), so a target that changes again mid-animation continues smoothly
 * instead of jumping back to the pre-animation value.
 */
export function useAnimatedNumber(target: number, durationMs = 700): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (displayRef.current === target) return;

    const from = displayRef.current;
    const delta = target - from;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + delta * eased);
      displayRef.current = next;
      setDisplay(next);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return display;
}
