import {
  query,
  type McpSdkServerConfigWithInstance,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { PushQueue } from "./queue.js";
import { PermissionBridge, type PendingPermissionRequest, type PermissionChoice } from "./permissions.js";

export interface BeaconSessionOptions {
  cwd: string;
  /** Resume an existing Claude Code session id — used both for a normal
   * resume and for adopt-via-resume of an external session. */
  resume?: string;
  model?: string;
  claudeExecutable?: string;
  /** In-process ticket-tool MCP server (see mcp/sdk-server.ts). Optional so
   * tests can construct a BeaconSession without a real TicketsCore. */
  mcpServer?: McpSdkServerConfigWithInstance;
}

export type BeaconSessionEvent =
  | { kind: "message"; message: SDKMessage }
  | { kind: "permission-request"; request: PendingPermissionRequest }
  | { kind: "closed"; error?: string };

/**
 * One agent Beacon owns end-to-end: launched via the Agent SDK in streaming
 * -input mode, so `interrupt()` and follow-up prompts work. See CLAUDE.md
 * for why streaming input (not a plain string prompt) is required for any
 * of this to function.
 */
export class BeaconSession {
  readonly id: string;
  readonly cwd: string;
  /** The Claude Code session id — known once the `system`/`init` message
   * arrives, not at construction time. */
  sessionId?: string;
  /** Set once the underlying session ends for any reason — natural
   * completion, a spawn/runtime error (e.g. a nonexistent cwd), or kill().
   * A dead BeaconSession never produces a sessionId or further messages.
   * Persisted here (not just emitted as a one-shot "closed" WS event) so a
   * client that connects or selects this agent *after* the failure already
   * happened — page reload, or just picking it from the sidebar later —
   * can still see it, instead of the UI showing "Starting…" forever with a
   * prompt box that silently no-ops. */
  ended = false;
  endError?: string;

  private readonly inbox = new PushQueue<SDKUserMessage>();
  private readonly abortController = new AbortController();
  private readonly permissions = new PermissionBridge();
  private readonly q: Query;
  private closed = false;

  onEvent?: (event: BeaconSessionEvent) => void;

  constructor(id: string, opts: BeaconSessionOptions) {
    this.id = id;
    this.cwd = opts.cwd;
    // A resumed session's id is already known synchronously — it's
    // opts.resume itself. Seed it immediately rather than waiting for the
    // system/init message: the underlying `claude` subprocess (streaming
    // input) emits nothing, including init, until the first prompt is
    // pushed into the inbox — and for adopt-via-resume specifically,
    // nothing can be pushed until the frontend already knows the agent's
    // sessionId (that's what unlocks the prompt box), which is a deadlock
    // without this. pump() below still overwrites this if init reports a
    // different id — e.g. the resume-cwd-mismatch trap in CLAUDE.md, which
    // silently starts a fresh session instead of resuming.
    if (opts.resume) this.sessionId = opts.resume;

    this.permissions.onRequest = (request) => {
      this.onEvent?.({ kind: "permission-request", request });
    };

    const options: Options = {
      cwd: opts.cwd,
      resume: opts.resume,
      model: opts.model,
      abortController: this.abortController,
      includePartialMessages: true,
      permissionMode: "default",
      canUseTool: this.permissions.canUseTool,
      stderr: (data) => console.error(`[beacon session ${id}]`, data.trimEnd()),
    };
    if (opts.claudeExecutable) options.pathToClaudeCodeExecutable = opts.claudeExecutable;
    if (opts.mcpServer) options.mcpServers = { beacon: opts.mcpServer };

    this.q = query({ prompt: this.inbox, options });
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.q) {
        if (message.type === "system" && message.subtype === "init") {
          this.sessionId = message.session_id;
        }
        this.onEvent?.({ kind: "message", message });
      }
      this.ended = true;
      this.onEvent?.({ kind: "closed" });
    } catch (err) {
      this.ended = true;
      this.endError = err instanceof Error ? err.message : String(err);
      this.onEvent?.({ kind: "closed", error: this.endError });
    }
  }

  /** Push a follow-up prompt into the running session. Queued while a turn
   * is in flight; call interrupt() first to redirect immediately instead. */
  send(text: string): void {
    this.inbox.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });
  }

  resolvePermission(requestId: string, choice: PermissionChoice, updatedInput?: Record<string, unknown>): boolean {
    return this.permissions.resolve(requestId, choice, updatedInput);
  }

  /** Stop the current turn; the session stays alive and usable afterward. */
  async interrupt(): Promise<void> {
    await this.q.interrupt();
  }

  /** Hard kill: subprocess + MCP transports torn down, session unusable after this. */
  kill(): void {
    if (this.closed) return;
    this.closed = true;
    this.inbox.close();
    this.q.close();
  }
}
