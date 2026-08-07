import { useEffect, useRef } from "react";
import "./ConfirmModal.css";

export interface ConfirmModalState {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colors the confirm button as a warning (adopt, interrupt) rather than
   * plain accent. Reserve real "danger" red styling for destructive,
   * unrecoverable actions elsewhere — this is closer to "heads up". */
  danger?: boolean;
  onConfirm: () => void;
}

/** Replaces window.confirm() with something that matches the app's own
 * theme instead of the browser chrome's unstyled native dialog — same
 * click-outside/Escape pattern as ContextMenu. */
export function ConfirmModal({ state, onClose }: { state: ConfirmModalState | null; onClose: () => void }) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!state) return;
    confirmRef.current?.focus();
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div className="confirm-modal__overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal__title">
        <div className="confirm-modal__title" id="confirm-modal__title">
          {state.title}
        </div>
        {state.description && <div className="confirm-modal__description">{state.description}</div>}
        <div className="confirm-modal__actions">
          <button className="confirm-modal__cancel" onClick={onClose}>
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            className={state.danger ? "confirm-modal__confirm confirm-modal__confirm--danger" : "confirm-modal__confirm"}
            onClick={() => {
              state.onConfirm();
              onClose();
            }}
          >
            {state.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
