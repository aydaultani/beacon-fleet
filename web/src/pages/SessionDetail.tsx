import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmModal, type ConfirmModalState } from "../components/ConfirmModal.js";
import { humanizeSessionError } from "../lib/sessionError.js";
import "./SessionDetail.css";

// Local DTOs mirroring src/server/transcripts/types.ts and
// src/server/supervisor/{session,permissions}.ts. Duplicated rather than
// imported: web/ has its own tsconfig rootDir (src only) and no shared
// package exists between server and web yet.

export type TranscriptEntryType = "user" | "assistant" | "system" | "attachment" | "other";

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface TranscriptEntry {
  type: TranscriptEntryType;
  uuid?: string;
  timestamp?: string;
  model?: string;
  usage?: TokenUsage;
  preview?: string;
  isError?: boolean;
  toolName?: string;
  toolDetail?: string;
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
  /** Set when this agent's session has already permanently ended by the
   * time this component mounted (BeaconSession.ended, from GET
   * /api/agents) — e.g. a launch failure from a bad cwd. Distinct from the
   * live `closed` state below, which only reflects a "closed" WS event
   * received *while this component is mounted*; a client that mounts
   * after the failure already happened would otherwise never learn about
   * it and show a permanently-stuck "Starting…" with a prompt box that
   * silently no-ops. */
  endError?: string;
}

const POLL_INTERVAL_MS = 1500;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

export function SessionDetail({ agentId, sessionId, endError: persistedEndError }: SessionDetailProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [permissionRequests, setPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [closed, setClosed] = useState<{ error?: string } | null>(null);
  // Prefer whichever fired: a live WS "closed" event this session actually
  // caught while mounted, or the persisted ended/endError already known
  // from GET /api/agents by the time this component mounted.
  const effectiveClosed = closed ?? (persistedEndError ? { error: persistedEndError } : null);
  const [promptText, setPromptText] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

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
    setAdopted(false);
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
    try {
      const res = await fetch(`/api/agents/${agentId}/interrupt`, { method: "POST" });
      if (!res.ok) setActionError(`Interrupt failed (${res.status})`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [agentId]);

  const kill = useCallback(async () => {
    if (!agentId) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/kill`, { method: "POST" });
      if (!res.ok) setActionError(`Kill failed (${res.status})`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [agentId]);

  const adopt = useCallback(async () => {
    if (!sessionId) return;
    setAdopting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/adopt`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Adopt failed (${res.status})`);
        return;
      }
      // The resumed session's own sessionId/agentId link shows up once its
      // system/init message arrives — that's the parent's useAgents() poll
      // (~2s), not something to hand-wire here. This just confirms the
      // stop+resume happened so the interrupted-work warning makes sense.
      setAdopted(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdopting(false);
    }
  }, [sessionId]);

  const resolvePermission = useCallback(
    async (requestId: string, choice: PermissionChoice) => {
      if (!agentId) return;
      try {
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
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [agentId],
  );

  if (!agentId && !sessionId) {
    return <div className="session-detail session-detail--empty">No session selected.</div>;
  }

  // Only what belongs in a chat: real user turns, assistant text, and
  // assistant tool actions. Everything else in the raw transcript (system
  // lines like turn_duration/stop_hook_summary, attachments, tool_result
  // -shaped "user" entries) is bookkeeping, not conversation, and gets left
  // out. Entries with no preview at all (e.g. a thinking-only block that
  // never produced text) are dropped too, instead of rendering as an empty
  // bubble.
  const chatEntries = entries.filter(
    (e) => (e.type === "user" || e.type === "assistant") && Boolean(e.preview && e.preview.trim().length > 0),
  );

  // Consecutive tool actions of the same tool (Bash, Bash, Bash, ...)
  // collapse into one "Bash ×5" line instead of repeating a row per call —
  // individual calls are still there, just behind a click.
  const chatItems = groupChatEntries(chatEntries);

  const disabledReason = !agentId
    ? "Disabled — this session isn't owned by Beacon. Adopt it above to send prompts, interrupt, or kill it."
    : effectiveClosed
      ? "Disabled — session ended, no longer accepting prompts."
      : null;

  return (
    <div className="session-detail">
      {sessionId && !agentId && !adopted && (
        <div className="banner banner--info adopt-banner">
          <span>Read-only — this session isn't owned by Beacon.</span>
          <button
            onClick={() =>
              setConfirmModal({
                title: "Adopt this session?",
                description:
                  "This stops the running process and resumes it under Beacon, interrupting any in-flight work.",
                confirmLabel: "Adopt",
                danger: true,
                onConfirm: () => void adopt(),
              })
            }
            disabled={adopting}
          >
            {adopting ? "Adopting…" : "Adopt"}
          </button>
        </div>
      )}
      {adopted && <div className="banner banner--info">Adopted — control should appear here shortly.</div>}

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

      <div className="chat" ref={transcriptRef}>
        {chatItems.length === 0 && !transcriptError && <div className="chat__hint">No messages yet.</div>}
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

      {transcriptError && <div className="banner banner--error">{transcriptError}</div>}
      {effectiveClosed && (
        <div className={`banner ${effectiveClosed.error ? "banner--error" : "banner--info"}`}>
          {effectiveClosed.error ? `Session ended: ${effectiveClosed.error}` : "Session ended."}
        </div>
      )}
      {actionError && <div className="banner banner--error">{actionError}</div>}

      <div className="controls">
        <textarea
          value={agentId ? promptText : ""}
          onChange={(e) => agentId && setPromptText(e.target.value)}
          placeholder={agentId ? "Send a follow-up prompt…" : disabledReason ?? ""}
          disabled={!agentId || sending || Boolean(effectiveClosed)}
          onKeyDown={(e) => {
            if (!agentId) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendPrompt();
            }
          }}
        />
        {disabledReason && <div className="controls__reason">{disabledReason}</div>}
        {agentId && (
          <div className="controls__buttons">
            <button onClick={() => void sendPrompt()} disabled={sending || !promptText.trim() || Boolean(effectiveClosed)}>
              Send
            </button>
            <button onClick={() => void interrupt()} disabled={Boolean(effectiveClosed)}>
              Interrupt
            </button>
            <button className="deny" onClick={() => void kill()} disabled={Boolean(effectiveClosed)}>
              Kill
            </button>
          </div>
        )}
      </div>

      <ConfirmModal state={confirmModal} onClose={() => setConfirmModal(null)} />
    </div>
  );
}

export type ChatItem = { kind: "message"; entry: TranscriptEntry } | { kind: "tool-group"; toolName: string; entries: TranscriptEntry[] };

export function groupChatEntries(entries: TranscriptEntry[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const entry of entries) {
    if (entry.type === "assistant" && entry.toolName) {
      const last = items[items.length - 1];
      if (last?.kind === "tool-group" && last.toolName === entry.toolName) {
        last.entries.push(entry);
        continue;
      }
      items.push({ kind: "tool-group", toolName: entry.toolName, entries: [entry] });
      continue;
    }
    items.push({ kind: "message", entry });
  }
  return items;
}

export function ToolGroup({ toolName, entries }: { toolName: string; entries: TranscriptEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 1) {
    const detail = entries[0]?.toolDetail;
    return (
      <div className="chat-msg chat-msg--tool">
        <span className="chat-msg__bullet">●</span>
        <span className="chat-msg__text">
          {toolName}
          {detail ? `: ${detail}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="chat-msg chat-msg--tool chat-msg--tool-group">
      <button className="chat-msg__group-toggle" onClick={() => setExpanded((e) => !e)}>
        <span className="chat-msg__bullet">●</span>
        <span className="chat-msg__text">
          {toolName} ×{entries.length}
        </span>
        <span className="chat-msg__chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="chat-msg__group-items">
          {entries.map((entry, i) => (
            <div key={entry.uuid ?? i} className="chat-msg__group-item">
              {entry.toolDetail ?? toolName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
