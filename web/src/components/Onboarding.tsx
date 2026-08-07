import { type ReactNode, useEffect, useState } from "react";
import "./Onboarding.css";

interface Step {
  icon: ReactNode;
  title: string;
  body: string;
  /** Label for the button that advances past this step — a concrete verb
   * ("Next", or the real next action on the last step) rather than a
   * generic "Continue" on every step. */
  cta: string;
}

const STEPS: Step[] = [
  {
    icon: <BeaconIcon />,
    title: "Welcome to Beacon",
    body: "Every Claude Code session on this machine, across every project, shows up here automatically — no setup per project. One tab to see what's running, jump in, and steer it.",
    cta: "Show me around",
  },
  {
    icon: <FleetIcon />,
    title: "Sessions, grouped by project",
    body: "The left sidebar lists every session, grouped by the folder it's running in. Drag a session (or right-click it) to move it into a different group — useful when a few sessions across different folders are really one piece of work. Tick \"Show only live sessions\" off if you want to see ended ones too.",
    cta: "Next",
  },
  {
    icon: <TreeIcon />,
    title: "See the whole tree, not just one session",
    body: "Click a session and its real subagents show up as a live diagram next to it — not something Beacon invented, this is Claude Code's actual delegation tree. Right-click a session to interrupt it, kill it, or delegate a task to a subagent directly. Drag a rectangle over several sessions to select and move them together.",
    cta: "Next",
  },
  {
    icon: <TicketIcon />,
    title: "Tickets agents can write to themselves",
    body: "Tickets are a to-do list that spans every project. File one, and any agent — including ones you haven't launched yet — can read, claim, and update it over MCP, no copy-pasting instructions between terminals.",
    cta: "Launch your first session",
  },
];

/** Shown on every load for now — deliberately no "seen it" localStorage
 * gate yet, per an explicit ask to keep it always-on while the content
 * settles. Purely in-memory: a reload always resets it back to step 0.
 * Swap in a persisted flag here once the copy is final. */
export function Onboarding() {
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  const lastStep = step === STEPS.length - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /** The last step's CTA doesn't just dismiss the dialog — it drops the
   * user straight into the one thing they're most likely here to do
   * first. Looked up by class rather than threaded through as a prop:
   * SessionsSidebar's launch field is a stable, single instance on the
   * Fleet view, and plumbing a ref through App.tsx for a one-off "focus
   * this on close" isn't worth the coupling. */
  function finish() {
    // Focus the input *before* removing this button from the DOM: closing
    // the modal synchronously here raced the browser's own native
    // focus-follows-click handling for the button just clicked, which
    // loses its target mid-flight when that button vanishes and falls
    // back to focusing <body> instead of wherever we just pointed it.
    // Deferring the unmount one tick lets our focus() win first.
    document.querySelector<HTMLInputElement>(".path-picker__input")?.focus();
    setTimeout(() => setOpen(false), 0);
  }

  if (!open) return null;

  // step is always kept in [0, STEPS.length - 1] by the clamped setters above.
  const current = STEPS[step]!;

  return (
    <div className="onboarding__overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding__title">
        <button className="onboarding__skip" onClick={() => setOpen(false)}>
          Skip
        </button>

        <div className="onboarding__body" key={step}>
          <div className="onboarding__icon">{current.icon}</div>
          <div className="onboarding__title" id="onboarding__title">
            {current.title}
          </div>
          <p className="onboarding__text">{current.body}</p>
        </div>

        <div className="onboarding__dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === step ? "onboarding__dot onboarding__dot--active" : "onboarding__dot"}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1} of ${STEPS.length}`}
            />
          ))}
        </div>

        <div className="onboarding__actions">
          <button className="onboarding__back" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0}>
            Back
          </button>
          {lastStep ? (
            <button className="onboarding__next onboarding__next--cta" onClick={finish}>
              {current.cta}
            </button>
          ) : (
            <button className="onboarding__next" onClick={() => setStep((s) => Math.min(s + 1, STEPS.length - 1))}>
              {current.cta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BeaconIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      <path d="M16 5.5v3M16 23.5v3M5.5 16h3M23.5 16h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FleetIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="7" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="25" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="25" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="25" cy="25" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 16H16M16 16V7H22M16 16H22M16 16V25H22" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  );
}

function TreeIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="10" y="4" width="12" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 11v4M16 15c0 3-5 3-5 6M16 15c0 3 5 3 5 6" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <rect x="4" y="21" width="9" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="19" y="21" width="9" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M6 12a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4v-2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M20 10v12" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 2.2" />
    </svg>
  );
}
