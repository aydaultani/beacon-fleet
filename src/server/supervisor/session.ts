import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { PushQueue } from "./queue.js";
import { PermissionBridge, type PendingPermissionRequest, type PermissionChoice } from "./permissions.js";

export interface BeaconSessionOptions {
  cwd: string;
  /** Resume an existing Claude Code session id — used both for a normal
   * resume and for adopt-via-resume of an external session. */
  resume?: string;
  model?: string;
  claudeExecutable?: string;
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

  private readonly inbox = new PushQueue<SDKUserMessage>();
  private readonly abortController = new AbortController();
  private readonly permissions = new PermissionBridge();
  private readonly q: Query;
  private closed = false;

  onEvent?: (event: BeaconSessionEvent) => void;

  constructor(id: string, opts: BeaconSessionOptions) {
    this.id = id;
    this.cwd = opts.cwd;

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
      this.onEvent?.({ kind: "closed" });
    } catch (err) {
      this.onEvent?.({ kind: "closed", error: err instanceof Error ? err.message : String(err) });
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
