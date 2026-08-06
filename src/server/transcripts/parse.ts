import type { TokenUsage, TranscriptEntry, TranscriptEntryType } from "./types.js";

/** Tolerant of malformed/partial JSON — a torn write mid-append should never crash discovery. */
export function parseTranscriptLine(line: string): TranscriptEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const type = normalizeType(raw.type);
  const message = isRecord(raw.message) ? raw.message : undefined;

  return {
    raw,
    type,
    uuid: asString(raw.uuid),
    parentUuid: raw.parentUuid === null ? null : asString(raw.parentUuid),
    sessionId: asString(raw.sessionId ?? raw.session_id),
    timestamp: asString(raw.timestamp),
    isSidechain: raw.isSidechain === true,
    agentId: asString(raw.agentId),
    cwd: asString(raw.cwd),
    gitBranch: asString(raw.gitBranch),
    version: asString(raw.version),
    model: asString(message?.model),
    messageId: asString(message?.id),
    usage: extractUsage(isRecord(message?.usage) ? message.usage : undefined),
    preview: extractPreview(type, message, raw),
    isError: raw.isApiErrorMessage === true,
  };
}

function normalizeType(value: unknown): TranscriptEntryType {
  if (value === "user" || value === "assistant" || value === "system" || value === "attachment") return value;
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function extractUsage(usage: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    cacheCreationInputTokens: asNumber(usage.cache_creation_input_tokens),
    cacheReadInputTokens: asNumber(usage.cache_read_input_tokens),
  };
}

function extractPreview(
  type: TranscriptEntryType,
  message: Record<string, unknown> | undefined,
  raw: Record<string, unknown>,
): string | undefined {
  if (type === "assistant" && message) {
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
          return truncate(block.text);
        }
      }
      for (const block of content) {
        if (isRecord(block) && block.type === "tool_use" && typeof block.name === "string") {
          return `→ ${block.name}`;
        }
      }
    }
  }

  if (type === "user" && message) {
    const content = message.content;
    if (typeof content === "string" && content.length > 0) return truncate(content);
  }

  if (type === "system" && typeof raw.subtype === "string") {
    return raw.subtype;
  }

  return undefined;
}

function truncate(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
