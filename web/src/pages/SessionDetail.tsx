import { useCallback, useEffect, useRef, useState } from "react";
import "./SessionDetail.css";

// Local DTOs mirroring src/server/transcripts/types.ts and
// src/server/supervisor/{session,permissions}.ts. Duplicated rather than
// imported: web/ has its own tsconfig rootDir (src only) and no shared
// package exists between server and web yet.

type TranscriptEntryType = "user" | "assistant" | "system" | "attachment" | "other";

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

interface TranscriptEntry {
  type: TranscriptEntryType;
  uuid?: string;
  timestamp?: string;
  model?: string;
  usage?: TokenUsage;
  preview?: string;
  isError?: boolean;
}

interface TranscriptPage {
  entries: TranscriptEntry[];
  nextOffset: number;
  fileSize: number;
}

interface PendingPermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  title: string;
  displayName?: string;
  description?: string;
}

type PermissionChoice = "once" | "always" | "deny";

type AgentEvent =
  | { kind: "message" }
  | { kind: "permission-request"; request: PendingPermissionRequest }
  | { kind: "closed"; error?: string };

type WsInboundMessage =
  | { type: "sessions" }
  | { type: "agent-event"; agentId: string; event: AgentEvent };

export interface SessionDetailProps {
  /** Beacon-owned agent id (from POST /api/agents). Required for
   * prompt/interrupt/kill/permissions — omit for a read-only, discovered-
   * only session. */
  agentId?: string;
  /** Claude Code session id. Required to read the transcript. For a
   * freshly launched owned agent this may be undefined until the
   * `system/init` message arrives server-side. */
  sessionId?: string;
}

const POLL_INTERVAL_MS = 1500;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

export function SessionDetail({ agentId, sessionId }: SessionDetailProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [permissionRequests, setPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [closed, setClosed] = useState<{ error?: string } | null>(null);
  const [promptText, setPromptText] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pollNowRef = useRef<() => void>(() => {});

  const fetchingRef = useRef(false);

  const fetchMore = useCallback(async () => {
    if (!sessionId || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/transcript?offset=${offsetRef.current}`);
      if (!res.ok) {
        if (res.status === 404) {
          setTranscriptError("Session not visible to discovery yet — retrying…");
          return;
        }
        setTranscriptError(`Transcript fetch failed (${res.status})`);
        return;
      }
      const page: TranscriptPage = await res.json();
      setTranscriptError(null);
      if (page.entries.length > 0) {
        setEntries((prev) => [...prev, ...page.entries]);
      }
      offsetRef.current = page.nextOffset;
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : String(err));
    } finally {
      fetchingRef.current = false;
    }
  }, [sessionId]);

  pollNowRef.current = fetchMore;

  // Reset when switching to a different session.
  useEffect(() => {
    setEntries([]);
    setTranscriptError(null);
    offsetRef.current = 0;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void fetchMore();
    const timer = window.setInterval(() => void fetchMore(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [sessionId, fetchMore]);

  useEffect(() => {
    if (!agentId) return;

    let socket: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(wsUrl());
      socket.onmessage = (ev) => {
        let msg: WsInboundMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type !== "agent-event" || msg.agentId !== agentId) return;

        if (msg.event.kind === "message") {
          void pollNowRef.current();
        } else if (msg.event.kind === "permission-request") {
          const { request } = msg.event;
          setPermissionRequests((prev) => (prev.some((r) => r.id === request.id) ? prev : [...prev, request]));
        } else if (msg.event.kind === "closed") {
          setClosed({ error: msg.event.error });
        }
      };
      socket.onclose = () => {
        if (!cancelled) window.setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [agentId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  const sendPrompt = useCallback(async () => {
    if (!agentId || !promptText.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: promptText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Failed (${res.status})`);
        return;
      }
      setPromptText("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [agentId, promptText]);

  const interrupt = useCallback(async () => {
    if (!agentId) return;
    setActionError(null);
    const res = await fetch(`/api/agents/${agentId}/interrupt`, { method: "POST" });
    if (!res.ok) setActionError(`Interrupt failed (${res.status})`);
  }, [agentId]);

  const kill = useCallback(async () => {
    if (!agentId) return;
    setActionError(null);
    const res = await fetch(`/api/agents/${agentId}/kill`, { method: "POST" });
    if (!res.ok) setActionError(`Kill failed (${res.status})`);
  }, [agentId]);

  const resolvePermission = useCallback(
    async (requestId: string, choice: PermissionChoice) => {
      if (!agentId) return;
      const res = await fetch(`/api/agents/${agentId}/permissions/${requestId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      if (res.ok) {
        setPermissionRequests((prev) => prev.filter((r) => r.id !== requestId));
      } else {
        setActionError(`Permission response failed (${res.status})`);
      }
    },
    [agentId],
  );

  if (!agentId && !sessionId) {
    return <div className="session-detail session-detail--empty">No session selected.</div>;
  }

  return (
    <div className="session-detail">
      {permissionRequests.length > 0 && (
        <div className="permission-cards">
          {permissionRequests.map((req) => (
            <div key={req.id} className="permission-card">
              <div className="permission-card__title">{req.title}</div>
              {req.description && <div className="permission-card__desc">{req.description}</div>}
              <div className="permission-card__tool">{req.displayName ?? req.toolName}</div>
              <div className="permission-card__actions">
                <button onClick={() => void resolvePermission(req.id, "once")}>Allow once</button>
                <button onClick={() => void resolvePermission(req.id, "always")}>Always allow</button>
                <button className="deny" onClick={() => void resolvePermission(req.id, "deny")}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="transcript" ref={transcriptRef}>
        {entries.length === 0 && !transcriptError && <div className="transcript__hint">No messages yet.</div>}
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

      {transcriptError && <div className="banner banner--error">{transcriptError}</div>}
      {closed && (
        <div className={`banner ${closed.error ? "banner--error" : "banner--info"}`}>
          {closed.error ? `Session ended: ${closed.error}` : "Session ended."}
        </div>
      )}
      {actionError && <div className="banner banner--error">{actionError}</div>}

      {agentId && (
        <div className="controls">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="Send a follow-up prompt…"
            disabled={sending || Boolean(closed)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendPrompt();
              }
            }}
          />
          <div className="controls__buttons">
            <button onClick={() => void sendPrompt()} disabled={sending || !promptText.trim() || Boolean(closed)}>
              Send
            </button>
            <button onClick={() => void interrupt()} disabled={Boolean(closed)}>
              Interrupt
            </button>
            <button className="deny" onClick={() => void kill()} disabled={Boolean(closed)}>
              Kill
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
