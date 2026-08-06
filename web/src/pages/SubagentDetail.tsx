import { useCallback, useEffect, useRef, useState } from "react";
import "./SessionDetail.css";

type TranscriptEntryType = "user" | "assistant" | "system" | "attachment" | "other";

interface TranscriptEntry {
  type: TranscriptEntryType;
  uuid?: string;
  preview?: string;
  isError?: boolean;
}

interface TranscriptPage {
  entries: TranscriptEntry[];
  nextOffset: number;
}

export interface SubagentDetailProps {
  sessionId: string;
  agentId: string;
}

const POLL_INTERVAL_MS = 2000;

/** Read-only transcript viewer for a real Claude Code subagent (Task-tool
 * sub-conversation). Subagents have no independent prompt/interrupt/kill —
 * they're internal to their parent session's own process — so this is
 * deliberately just the transcript, reusing SessionDetail.css's classes
 * rather than duplicating the same visual language. */
export function SubagentDetail({ sessionId, agentId }: SubagentDetailProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const fetchingRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const fetchMore = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/subagents/${agentId}/transcript?offset=${offsetRef.current}`);
      if (!res.ok) {
        setError(`Transcript fetch failed (${res.status})`);
        return;
      }
      const page: TranscriptPage = await res.json();
      setError(null);
      if (page.entries.length > 0) setEntries((prev) => [...prev, ...page.entries]);
      offsetRef.current = page.nextOffset;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      fetchingRef.current = false;
    }
  }, [sessionId, agentId]);

  useEffect(() => {
    setEntries([]);
    setError(null);
    offsetRef.current = 0;
  }, [sessionId, agentId]);

  useEffect(() => {
    void fetchMore();
    const timer = window.setInterval(() => void fetchMore(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchMore]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="session-detail">
      <div className="transcript" ref={transcriptRef}>
        {entries.length === 0 && !error && <div className="transcript__hint">No messages yet.</div>}
        {entries.map((entry, i) => (
          <div
            key={entry.uuid ?? i}
            className={`transcript-entry transcript-entry--${entry.type}${entry.isError ? " transcript-entry--error" : ""}`}
          >
            <span className="transcript-entry__role">{entry.type}</span>
            <span className="transcript-entry__preview">{entry.preview ?? ""}</span>
          </div>
        ))}
      </div>
      {error && <div className="banner banner--error">{error}</div>}
    </div>
  );
}
