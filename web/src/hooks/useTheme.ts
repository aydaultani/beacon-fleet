import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "beacon-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in private/storage-restricted contexts — fall
    // through to the system preference for this session.
  }
  return systemTheme();
}

/** Explicit light/dark toggle, persisted to localStorage. index.html sets
 * documentElement's data-theme synchronously before React mounts (avoids a
 * flash of the wrong theme); this hook reads that same initial value back
 * so the two never disagree, then keeps the DOM attribute in sync on toggle. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? readTheme(),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Same storage-restricted fallback as above — theme still applies for
      // this session via the DOM attribute, it just won't persist.
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);

  return [theme, toggle];
}
