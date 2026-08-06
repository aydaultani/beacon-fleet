export type TranscriptEntryType = "user" | "assistant" | "system" | "attachment" | "other";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Normalized view of one raw transcript line. Deliberately not a 1:1 copy
 * of the raw JSON — `raw` is kept for anything a future feature needs that
 * isn't promoted to a typed field yet. See CLAUDE.md for the full
 * documented on-disk schema this is parsed from.
 */
export interface TranscriptEntry {
  raw: Record<string, unknown>;
  type: TranscriptEntryType;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  agentId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  model?: string;
  /** `message.id` — the key for deduping usage across split content-block lines. */
  messageId?: string;
  usage?: TokenUsage;
  preview?: string;
  isError?: boolean;
}
