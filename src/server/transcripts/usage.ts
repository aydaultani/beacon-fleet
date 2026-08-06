import type { TranscriptEntry } from "./types.js";

export interface SessionUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * One API response is split across multiple `assistant` lines that all
 * repeat the same `message.id` and `message.usage` object — summing every
 * line roughly doubles the true total. Dedup by `message.id` first. See
 * CLAUDE.md.
 */
export function sumUsage(entries: TranscriptEntry[]): SessionUsageTotals {
  const seen = new Set<string>();
  const totals: SessionUsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  for (const entry of entries) {
    if (!entry.usage || !entry.messageId || seen.has(entry.messageId)) continue;
    seen.add(entry.messageId);
    totals.inputTokens += entry.usage.inputTokens;
    totals.outputTokens += entry.usage.outputTokens;
    totals.cacheCreationInputTokens += entry.usage.cacheCreationInputTokens;
    totals.cacheReadInputTokens += entry.usage.cacheReadInputTokens;
  }

  return totals;
}
