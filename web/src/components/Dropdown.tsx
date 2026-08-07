import { useEffect, useRef, useState } from "react";
import "./Dropdown.css";

export interface DropdownOption {
  value: string;
  label: string;
  /** Full-length text for the title attribute, when label is truncated. */
  title?: string;
}

export interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder: string;
  /** Rendered as a distinct row below a divider, e.g. "+ New path…". */
  extraOption?: DropdownOption;
  disabled?: boolean;
  className?: string;
}

/** A styled stand-in for <select>, matching PathPicker's popover pattern
 * instead of the native browser dropdown (which doesn't pick up the app's
 * dark theme on most platforms). */
export function Dropdown({ value, options, onChange, placeholder, extraOption, disabled, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`dropdown${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        type="button"
        className="dropdown__trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={selected?.title ?? selected?.label}
      >
        <span className={`dropdown__value${selected ? "" : " dropdown__value--placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="dropdown__popover" role="listbox">
          <div className="dropdown__list">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`dropdown__row${opt.value === value ? " dropdown__row--selected" : ""}`}
                title={opt.title ?? opt.label}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
            {options.length === 0 && !extraOption && <div className="dropdown__hint">Nothing to pick from.</div>}
          </div>
          {extraOption && (
            <div className="dropdown__extra">
              <button
                type="button"
                className="dropdown__row dropdown__row--extra"
                onClick={() => {
                  onChange(extraOption.value);
                  setOpen(false);
                }}
              >
                {extraOption.label}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="dropdown__chevron"
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : undefined }}
    >
      <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
