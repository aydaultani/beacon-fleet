import { useEffect, useMemo, useRef, useState } from "react";
import { useUsage } from "../hooks/useUsage.js";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber.js";
import { useSessions, type SessionStatus } from "../hooks/useSessions.js";
import { useSoundEnabled } from "../hooks/useSoundEnabled.js";
import { playTokenChime } from "../lib/tokenChime.js";
import "./HeaderStats.css";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const zoneFormatter = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function zoneLabel(date: Date): string {
  const part = zoneFormatter.formatToParts(date).find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/** Live wall-clock, ticking every second — not throttled to a poll
 * interval like the rest of the app's data, since a clock reading stale
 * seconds would be immediately obvious. */
export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="header-clock" title={dateFormatter.format(now)}>
      <span className="header-clock__time mono">{timeFormatter.format(now)}</span>
      <span className="header-clock__zone">{zoneLabel(now)}</span>
      <span className="header-clock__sep">·</span>
      <span className="header-clock__date">{dateFormatter.format(now)}</span>
    </div>
  );
}

/** Machine-wide token spend (see useUsage.ts / server machine-usage.ts),
 * animated with a subtle count-up tween, a brief pulse, and (unless muted)
 * a short synthesized chime whenever the total climbs — reads as "live"
 * without being distracting. */
export function TokenUsageBadge() {
  const usage = useUsage();
  const target = usage?.totalTokens ?? 0;
  const display = useAnimatedNumber(target);
  const [soundEnabled, toggleSound] = useSoundEnabled();

  const [pulsing, setPulsing] = useState(false);
  const prevTargetRef = useRef(target);
  const pulseTimerRef = useRef<number | undefined>(undefined);
  // Only react to increases once real data has arrived at least once —
  // without this, the jump from the initial 0 to the first real total
  // would itself pulse/chime on every page load.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (usage === null) return;
    if (hasLoadedRef.current && target > prevTargetRef.current) {
      setPulsing(true);
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = window.setTimeout(() => setPulsing(false), 600);
      if (soundEnabled) playTokenChime();
    }
    hasLoadedRef.current = true;
    prevTargetRef.current = target;
    return () => {
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    };
  }, [target, usage, soundEnabled]);

  const breakdown = usage
    ? `Input ${usage.inputTokens.toLocaleString()} · Output ${usage.outputTokens.toLocaleString()} · Cache write ${usage.cacheCreationInputTokens.toLocaleString()} · Cache read ${usage.cacheReadInputTokens.toLocaleString()}`
    : "Loading token usage…";

  return (
    <div className={`token-badge${pulsing ? " token-badge--pulse" : ""}`}>
      <span className="token-badge__dot" aria-hidden="true" />
      <span className="token-badge__value mono" title={breakdown}>
        {display.toLocaleString()}
      </span>
      <span className="token-badge__label">tokens</span>
      <button
        type="button"
        className="token-badge__sound-toggle"
        onClick={toggleSound}
        aria-label={soundEnabled ? "Mute token sound" : "Unmute token sound"}
        title={soundEnabled ? "Mute token sound" : "Unmute token sound"}
      >
        {soundEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
      </button>
    </div>
  );
}

function SpeakerOnIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 6.2h2.3L7.6 3.6v8.8L4.3 9.8H2z" fill="currentColor" />
      <path
        d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 3.8a6 6 0 0 1 0 8.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 6.2h2.3L7.6 3.6v8.8L4.3 9.8H2z" fill="currentColor" />
      <path d="M10.4 6.1l3.4 3.8M13.8 6.1l-3.4 3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// "offline" isn't a SessionStatus value — it's DiscoveredSession.alive === false,
// tracked independently of `status` (see useSessions.ts / CLAUDE.md's
// stale-on-crash trap). Bucketing checks `alive` first so an offline
// session's last-known status doesn't also double-count it elsewhere.
type StatusBucket = SessionStatus | "offline";

const BUCKET_ORDER: StatusBucket[] = ["busy", "waiting", "idle", "shell", "offline", "unknown"];
const BUCKET_LABEL: Record<StatusBucket, string> = {
  busy: "running",
  waiting: "waiting",
  idle: "idle",
  shell: "shell",
  offline: "offline",
  unknown: "unknown",
};

function emptyCounts(): Record<StatusBucket, number> {
  return { busy: 0, waiting: 0, idle: 0, shell: 0, offline: 0, unknown: 0 };
}

/** Live breakdown of every discovered session by status — same data
 * SessionsSidebar renders per-row, just aggregated. Pushed over the same
 * /ws hub as everything else (useSessions), so it moves the instant a
 * session's status.json changes, not on a poll. */
export function AgentStatusSummary() {
  const { sessions } = useSessions();

  const counts = useMemo(() => {
    const c = emptyCounts();
    for (const session of sessions) {
      const bucket: StatusBucket = session.alive ? session.status : "offline";
      c[bucket] += 1;
    }
    return c;
  }, [sessions]);

  if (sessions.length === 0) return null;

  return (
    <div className="agent-status-summary" title={`${sessions.length} session${sessions.length === 1 ? "" : "s"} total`}>
      {BUCKET_ORDER.filter((bucket) => counts[bucket] > 0).map((bucket) => (
        <span key={bucket} className="agent-status-summary__item">
          <span className={`agent-status-summary__dot agent-status-summary__dot--${bucket}`} aria-hidden="true" />
          <span className="agent-status-summary__count mono">{counts[bucket]}</span>
          <span className="agent-status-summary__label">{BUCKET_LABEL[bucket]}</span>
        </span>
      ))}
    </div>
  );
}
