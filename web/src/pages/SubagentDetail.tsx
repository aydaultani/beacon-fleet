import { useCallback, useEffect, useRef, useState } from "react";
import { groupChatEntries, ToolGroup, type TranscriptEntry } from "./SessionDetail.js";
import "./SessionDetail.css";

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

  // Same filter as SessionDetail's chatEntries: only user/assistant turns
  // with real text — tool-result/attachment/system lines are noise in
  // this view, and a thinking-only block that produced no text would
  // otherwise render as an empty bubble. Grouping (groupChatEntries) also
  // shared with SessionDetail so a run of the same tool call collapses the
  // same way here.
  const chatEntries = entries.filter(
    (e) => (e.type === "user" || e.type === "assistant") && Boolean(e.preview && e.preview.trim().length > 0),
  );
  const chatItems = groupChatEntries(chatEntries);

  return (
    <div className="session-detail">
      <div className="chat" ref={transcriptRef}>
        {chatItems.length === 0 && !error && <div className="chat__hint">No messages yet.</div>}
        {chatItems.map((item, i) =>
          item.kind === "tool-group" ? (
            <ToolGroup key={item.entries[0]?.uuid ?? i} toolName={item.toolName} entries={item.entries} />
          ) : (
            <div
              key={item.entry.uuid ?? i}
              className={`chat-msg chat-msg--${item.entry.type}${item.entry.isError ? " chat-msg--error" : ""}`}
            >
              {item.entry.type === "user" && <span className="chat-msg__marker">›</span>}
              <span className="chat-msg__text">{item.entry.preview}</span>
            </div>
          ),
        )}
      </div>
      {error && <div className="banner banner--error">{error}</div>}
    </div>
  );
}
