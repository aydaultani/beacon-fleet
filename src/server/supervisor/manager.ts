import { randomUUID } from "node:crypto";
import { isPidAlive, verifyProcStart } from "../discovery/liveness.js";
import { createBeaconSdkMcpServer } from "../mcp/sdk-server.js";
import type { TicketsCore } from "../mcp/tickets-contract.js";
import { BeaconSession, type BeaconSessionEvent } from "./session.js";

export interface LaunchOptions {
  cwd: string;
  resume?: string;
  model?: string;
}

export interface AdoptOptions {
  sessionId: string;
  cwd: string;
  pid: number;
  procStart?: string;
}

/**
 * Tracks every agent Beacon owns — launched directly, or adopted from an
 * external session. Discovered-but-not-owned sessions never appear here;
 * they live only in the discovery service (see ../discovery).
 */
export class SupervisorManager {
  private sessions = new Map<string, BeaconSession>();

  onEvent?: (beaconSessionId: string, event: BeaconSessionEvent) => void;

  /** Optional: when set, every launched/adopted session gets the in-process
   * ticket-tool MCP server wired in automatically (see mcp/sdk-server.ts).
   * A fresh server config is created per session rather than shared, since
   * each is just a lightweight tool-definition wrapper, not a persistent
   * connection. */
  constructor(private readonly tickets?: TicketsCore) {}

  launch(opts: LaunchOptions): BeaconSession {
    const id = randomUUID();
    const mcpServer = this.tickets ? createBeaconSdkMcpServer(this.tickets) : undefined;
    const session = new BeaconSession(id, { ...opts, mcpServer });
    session.onEvent = (event) => this.onEvent?.(id, event);
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): BeaconSession | undefined {
    return this.sessions.get(id);
  }

  list(): BeaconSession[] {
    return Array.from(this.sessions.values());
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill();
    this.sessions.delete(id);
    return true;
  }

  /**
   * Adopt-via-resume: stop an external session Beacon didn't launch, then
   * resume the same sessionId (with its recorded cwd) under a Beacon-owned
   * session, so history is preserved and control becomes full. Uses only
   * public API — Beacon never speaks the private daemon control-socket
   * protocol this replaces. See CLAUDE.md.
   *
   * Verifies the pid against its recorded start time before signalling it,
   * to avoid killing an unrelated process that reused the pid.
   */
  async adopt(external: AdoptOptions): Promise<BeaconSession> {
    if (isPidAlive(external.pid)) {
      const verified = await verifyProcStart(external.pid, external.procStart);
      if (!verified) {
        throw new Error(`refusing to adopt session ${external.sessionId}: pid ${external.pid} no longer matches the recorded process`);
      }
      process.kill(external.pid, "SIGTERM");
      await waitForExit(external.pid);
    }

    return this.launch({ cwd: external.cwd, resume: external.sessionId });
  }
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (isPidAlive(pid)) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
