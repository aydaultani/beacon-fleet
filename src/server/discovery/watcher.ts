import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { CLAUDE_JOBS_DIR, CLAUDE_SESSIONS_DIR } from "./claude-home.js";
import { readJobStates } from "./jobs.js";
import { mergeSessions } from "./merge.js";
import { reconcileWithCli, type CliAgentEntry } from "./reconcile.js";
import { readSessionRegistry } from "./registry.js";
import type { DiscoveredSession } from "./types.js";

const RECONCILE_INTERVAL_MS = 10_000;
const FS_EVENT_DEBOUNCE_MS = 150;

export interface DiscoveryServiceEvents {
  update: [sessions: DiscoveredSession[]];
}

/**
 * Live discovery of every Claude Code session on the machine. Watches
 * `~/.claude/{sessions,jobs}` for fast local updates and periodically
 * cross-checks against `claude agents --json --all`, which is slower
 * (spawns a process) but authoritative for anything the file-based sources
 * miss.
 */
export class DiscoveryService extends EventEmitter {
  private sessions: DiscoveredSession[] = [];
  private lastCliAgents: CliAgentEntry[] = [];
  private watchers: FSWatcher[] = [];
  private reconcileTimer?: NodeJS.Timeout;
  private debounceTimer?: NodeJS.Timeout;

  async start(): Promise<void> {
    await this.refresh(true);

    for (const dir of [CLAUDE_SESSIONS_DIR, CLAUDE_JOBS_DIR]) {
      try {
        this.watchers.push(watch(dir, { persistent: false }, () => this.scheduleFastRefresh()));
      } catch {
        // Directory may not exist yet (e.g. no background jobs have ever
        // run). The periodic CLI reconcile below still covers this case.
      }
    }

    this.reconcileTimer = setInterval(() => void this.refresh(true), RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref();
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  list(): DiscoveredSession[] {
    return this.sessions;
  }

  private scheduleFastRefresh(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh(false);
    }, FS_EVENT_DEBOUNCE_MS);
  }

  private async refresh(withCli: boolean): Promise<void> {
    const [registry, jobs] = await Promise.all([readSessionRegistry(), readJobStates()]);
    if (withCli) {
      this.lastCliAgents = await reconcileWithCli().catch(() => this.lastCliAgents);
    }
    this.sessions = mergeSessions(registry, jobs, this.lastCliAgents);
    this.emit("update", this.sessions);
  }
}
