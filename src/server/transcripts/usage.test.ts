import { test } from "node:test";
import assert from "node:assert/strict";
import { sumUsage } from "./usage.js";
import type { TranscriptEntry } from "./types.js";

function entry(messageId: string | undefined, usage: TranscriptEntry["usage"]): TranscriptEntry {
  return { raw: {}, type: "assistant", messageId, usage };
}

test("sums usage across distinct messages", () => {
  const totals = sumUsage([
    entry("m1", { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
    entry("m2", { inputTokens: 20, outputTokens: 15, cacheCreationInputTokens: 1, cacheReadInputTokens: 2 }),
  ]);
  assert.deepEqual(totals, { inputTokens: 30, outputTokens: 20, cacheCreationInputTokens: 1, cacheReadInputTokens: 2 });
});

test("does not double-count split content-block lines sharing one message.id", () => {
  const usage = { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: 10, cacheReadInputTokens: 5 };
  // Same API response split across three lines (text, thinking, tool_use
  // blocks), each repeating the identical message.id and usage object —
  // the real shape documented in CLAUDE.md.
  const totals = sumUsage([entry("m1", usage), entry("m1", usage), entry("m1", usage)]);
  assert.deepEqual(totals, usage);
});

test("ignores entries with no usage or no messageId", () => {
  const totals = sumUsage([
    entry(undefined, { inputTokens: 999, outputTokens: 999, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
    { raw: {}, type: "user" },
    entry("m1", { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }),
  ]);
  assert.deepEqual(totals, { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
});

test("empty input yields zeroed totals", () => {
  assert.deepEqual(sumUsage([]), {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });
});
