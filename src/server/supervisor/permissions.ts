import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

export interface PendingPermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  title: string;
  displayName?: string;
  description?: string;
  agentID?: string;
}

export type PermissionChoice = "once" | "always" | "deny";

interface PendingEntry {
  resolve: (result: PermissionResult) => void;
  input: Record<string, unknown>;
}

/**
 * Bridges the SDK's `canUseTool` callback to a browser-driven approve/deny
 * flow. The callback is designed to stay pending indefinitely until
 * `resolve()` is called from an API/WS handler triggered by a UI click —
 * that is the intended pattern, not a workaround.
 *
 * Trap: tools auto-approved by `allowedTools`/`permissionMode` never reach
 * this callback at all. Don't rely on this bridge alone to know every tool
 * use — it only sees what actually needed a decision.
 */
export class PermissionBridge {
  private pending = new Map<string, PendingEntry>();

  onRequest?: (request: PendingPermissionRequest) => void;

  readonly canUseTool: CanUseTool = async (toolName, input, opts) => {
    const request: PendingPermissionRequest = {
      id: opts.toolUseID,
      toolName,
      input,
      title: opts.title ?? `Claude wants to use ${toolName}`,
      displayName: opts.displayName,
      description: opts.description,
      agentID: opts.agentID,
    };

    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(opts.toolUseID, { resolve, input });
      opts.signal.addEventListener("abort", () => {
        if (this.pending.delete(opts.toolUseID)) {
          resolve({ behavior: "deny", message: "Cancelled", decisionClassification: "user_reject" });
        }
      });
      this.onRequest?.(request);
    });
  };

  resolve(id: string, choice: PermissionChoice, updatedInput?: Record<string, unknown>): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);

    if (choice === "deny") {
      entry.resolve({ behavior: "deny", message: "User denied this action", decisionClassification: "user_reject" });
    } else {
      entry.resolve({
        behavior: "allow",
        updatedInput: updatedInput ?? entry.input,
        decisionClassification: choice === "always" ? "user_permanent" : "user_temporary",
      });
    }
    return true;
  }
}
