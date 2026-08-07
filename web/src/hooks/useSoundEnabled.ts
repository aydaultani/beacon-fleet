import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "beacon-token-sound";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // localStorage can throw in private/storage-restricted contexts — default on.
    return true;
  }
}

/** Whether the token-usage chime plays, persisted to localStorage. Defaults
 * to on — see TokenUsageBadge.tsx for where this gates playTokenChime(). */
export function useSoundEnabled(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(readEnabled);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
      // Same storage-restricted fallback as above — setting still applies
      // for this session, it just won't persist.
    }
  }, [enabled]);

  const toggle = useCallback(() => setEnabled((e) => !e), []);

  return [enabled, toggle];
}
