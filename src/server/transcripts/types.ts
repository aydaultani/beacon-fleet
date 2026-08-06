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
  /** Set when this entry is an assistant tool_use with no accompanying text
   * block — the raw tool name (e.g. "Bash", "Read"), for grouping runs of
   * the same tool in the UI ("Bash ×5") instead of repeating a line per call. */
  toolName?: string;
  /** Brief per-call argument summary (command/file_path/pattern/url/query,
   * whichever the tool has) — what makes each call in a collapsed group
   * distinguishable once expanded. Absent if the tool's input has none of
   * the recognized fields. */
  toolDetail?: string;
}
