import { open } from "node:fs/promises";

export interface TailResult {
  lines: string[];
  nextOffset: number;
  fileSize: number;
}

/**
 * Reads only the bytes appended since `offset`, mirroring the
 * `linkScanOffset` incremental-tail approach Claude Code's own daemon uses
 * (see CLAUDE.md) — never re-parses a multi-MB transcript from the start.
 *
 * A trailing partial line (the writer mid-append) is held back and not
 * counted into `nextOffset`, so the next call re-reads and completes it
 * instead of yielding truncated JSON.
 */
export async function readLinesSince(filePath: string, offset: number): Promise<TailResult> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    const fileSize = stat.size;
    if (fileSize <= offset) {
      return { lines: [], nextOffset: offset, fileSize };
    }

    const length = fileSize - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    const text = buffer.toString("utf8");

    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline === -1) {
      return { lines: [], nextOffset: offset, fileSize };
    }

    const complete = text.slice(0, lastNewline);
    const consumedBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");
    const lines = complete.split("\n").filter((line) => line.length > 0);

    return { lines, nextOffset: offset + consumedBytes, fileSize };
  } finally {
    await handle.close();
  }
}
