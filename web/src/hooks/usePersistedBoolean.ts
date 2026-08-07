import { useEffect, useState } from "react";

/** Boolean UI state (panel collapsed, etc.) persisted to localStorage, mirroring useTheme's read/write pattern. */
export function usePersistedBoolean(
  storageKey: string,
  defaultValue: boolean,
): [boolean, (value: boolean | ((v: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultValue : stored === "true";
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(value));
    } catch {
      // localStorage can throw in private/storage-restricted contexts — state
      // still applies for this session, it just won't persist.
    }
  }, [storageKey, value]);

  return [value, setValue];
}
