import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { CLAUDE_PROJECTS_DIR } from "../discovery/claude-home.js";
import { readLinesSince } from "./tail.js";
import { parseTranscriptLine } from "./parse.js";
import { sumUsage, type SessionUsageTotals } from "./usage.js";
import type { TranscriptEntry } from "./types.js";

export interface MachineUsageTotals extends SessionUsageTotals {
  totalTokens: number;
  updatedAt: number;
}

interface FileCacheEntry {
  size: number;
  totals: SessionUsageTotals;
}

function zeroTotals(): SessionUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
}

function add(target: SessionUsageTotals, delta: SessionUsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.cacheCreationInputTokens += delta.cacheCreationInputTokens;
  target.cacheReadInputTokens += delta.cacheReadInputTokens;
}

async function walk(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Missing dir, permissions, mid-rename — just contribute nothing this pass.
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, results);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(path);
    }
  }
}

/**
 * Machine-wide token spend across every transcript this machine has ever
 * recorded — every `.jsonl` under the projects root, main sessions and
 * subagent sub-transcripts alike (subagent transcripts sit at
 * `<sessionId>/subagents/agent-<id>.jsonl`, which the recursive walk picks
 * up for free). Same per-file `message.id` dedup as a single session (see
 * usage.ts / CLAUDE.md) — dedup only needs to happen within one file since
 * `message.id` is generated per API response and never shared across
 * sessions.
 *
 * Re-parsing months of transcript history on every poll would be too slow,
 * so completed files are cached by size: a file whose size hasn't changed
 * since the last scan reuses its cached totals unread. Only actively
 * growing files (the live sessions) get re-read, and re-read in full rather
 * than tailed — tailing would risk double-counting a `message.id` whose
 * repeated lines land in different scan windows mid-stream.
 *
 * Emits `"update"` with the fresh totals after every scan, mirroring
 * DiscoveryService's EventEmitter pattern — ws.ts fans this out to the
 * browser the same way it fans out session updates, so the header token
 * count moves live rather than on a client-side poll timer.
 */
export class MachineUsageTracker extends EventEmitter {
  private readonly root: string;
  private readonly cache = new Map<string, FileCacheEntry>();
  private totals: MachineUsageTotals = { ...zeroTotals(), totalTokens: 0, updatedAt: 0 };
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(root: string = CLAUDE_PROJECTS_DIR) {
    super();
    this.root = root;
  }

  async start(intervalMs = 2000): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getTotals(): MachineUsageTotals {
    return this.totals;
  }

  async scan(): Promise<MachineUsageTotals> {
    const files: string[] = [];
    await walk(this.root, files);

    const next = zeroTotals();
    for (const path of files) {
      add(next, await this.fileTotals(path));
    }

    // Files that vanished since the last scan (deleted history) shouldn't
    // linger in the cache forever.
    const seen = new Set(files);
    for (const cachedPath of this.cache.keys()) {
      if (!seen.has(cachedPath)) this.cache.delete(cachedPath);
    }

    this.totals = {
      ...next,
      totalTokens: next.inputTokens + next.outputTokens + next.cacheCreationInputTokens + next.cacheReadInputTokens,
      updatedAt: Date.now(),
    };
    this.emit("update", this.totals);
    return this.totals;
  }

  private async fileTotals(path: string): Promise<SessionUsageTotals> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return zeroTotals();
    }

    const cached = this.cache.get(path);
    if (cached && cached.size === size) return cached.totals;

    const tail = await readLinesSince(path, 0);
    const entries = tail.lines.map(parseTranscriptLine).filter((e): e is TranscriptEntry => e !== null);
    const totals = sumUsage(entries);
    this.cache.set(path, { size: tail.fileSize, totals });
    return totals;
  }
}
