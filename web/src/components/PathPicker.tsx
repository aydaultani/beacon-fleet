import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./PathPicker.css";

interface FsEntry {
  name: string;
  path: string;
}

interface FsListing {
  dir: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface PathPickerProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}

/** Text input + a real directory browser, backed by GET /api/fs/list.
 * The browser's own File/webkitdirectory APIs never expose an absolute
 * filesystem path (deliberate sandboxing) — Beacon's server already has
 * real filesystem access, so it lists directories itself instead. */
export function PathPicker({ value, onChange, placeholder, disabled, onKeyDown }: PathPickerProps) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (dir?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = dir ? `/api/fs/list?dir=${encodeURIComponent(dir)}` : "/api/fs/list";
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setListing(body as FsListing);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(value.trim() || undefined);
  }, [open, load, value]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="path-picker" ref={rootRef}>
      <input
        className="path-picker__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="path-picker__browse"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Browse for a folder"
        title="Browse for a folder"
      >
        <FolderIcon />
      </button>

      {open && (
        <div className="path-picker__popover" role="dialog" aria-label="Choose a folder">
          <div className="path-picker__current" title={listing?.dir ?? ""}>
            {listing?.dir ?? "…"}
          </div>
          <div className="path-picker__list">
            {loading && <div className="path-picker__hint">Loading…</div>}
            {error && <div className="path-picker__error">{error}</div>}
            {!loading &&
              !error &&
              listing?.parent && (
                <button className="path-picker__row path-picker__row--up" onClick={() => void load(listing.parent!)}>
                  <FolderIcon />
                  <span>..</span>
                </button>
              )}
            {!loading &&
              !error &&
              listing?.entries.map((entry) => (
                <button key={entry.path} className="path-picker__row" onClick={() => void load(entry.path)}>
                  <FolderIcon />
                  <span>{entry.name}</span>
                </button>
              ))}
            {!loading && !error && listing && listing.entries.length === 0 && (
              <div className="path-picker__hint">No subfolders here.</div>
            )}
          </div>
          <div className="path-picker__footer">
            <button
              className="path-picker__select"
              disabled={!listing}
              onClick={() => {
                if (listing) onChange(listing.dir);
                setOpen(false);
              }}
            >
              Use this folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 3.5A1 1 0 0 1 2.5 2.5H6l1.5 1.5H13.5A1 1 0 0 1 14.5 5V12.5A1 1 0 0 1 13.5 13.5H2.5A1 1 0 0 1 1.5 12.5V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
