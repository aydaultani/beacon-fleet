import { getSessionInfo, type SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { transcriptPath } from "./paths.js";
import { readLinesSince } from "./tail.js";
import { parseTranscriptLine } from "./parse.js";
import { sumUsage, type SessionUsageTotals } from "./usage.js";
import type { TranscriptEntry } from "./types.js";

export interface TranscriptPage {
  entries: TranscriptEntry[];
  nextOffset: number;
  fileSize: number;
  /** Totals for just this page. Callers reading the full history (offset 0)
   * get session-wide totals; callers tailing get a delta to accumulate. */
  usage: SessionUsageTotals;
}

/**
 * Reads the transcript directly rather than through the SDK's
 * `getSessionMessages()`: that function's `SessionMessage` type omits
 * `timestamp` and `toolUseResult`, both required for a live dashboard.
 * Session *metadata* (title resolution, lastModified) still goes through
 * the SDK's `getSessionInfo()` below — re-implementing its title-priority
 * logic (custom-title > agent-name > ai-title > first prompt) would just be
 * a worse copy of already-correct code.
 */
export async function readTranscriptHistory(cwd: string, sessionId: string): Promise<TranscriptPage> {
  return readTranscriptSince(cwd, sessionId, 0);
}

export async function readTranscriptSince(cwd: string, sessionId: string, offset: number): Promise<TranscriptPage> {
  return readTranscriptAtPathSince(transcriptPath(cwd, sessionId), offset);
}

/** Shared by readTranscriptSince (main transcript) and the subagent reader
 * (subagents.ts) — both are just a JSONL file at a known path, tailed the
 * same way. */
export async function readTranscriptAtPathSince(path: string, offset: number): Promise<TranscriptPage> {
  let tail: Awaited<ReturnType<typeof readLinesSince>>;
  try {
    tail = await readLinesSince(path, offset);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { entries: [], nextOffset: offset, fileSize: offset, usage: sumUsage([]) };
    }
    throw err;
  }

  const entries = tail.lines
    .map(parseTranscriptLine)
    .filter((entry): entry is TranscriptEntry => entry !== null);

  return { entries, nextOffset: tail.nextOffset, fileSize: tail.fileSize, usage: sumUsage(entries) };
}

export async function readSessionMeta(sessionId: string, dir?: string): Promise<SDKSessionInfo | undefined> {
  try {
    return await getSessionInfo(sessionId, dir ? { dir } : undefined);
  } catch {
    return undefined;
  }
}
