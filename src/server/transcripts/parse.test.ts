import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptLine } from "./parse.js";

test("returns null for blank lines", () => {
  assert.equal(parseTranscriptLine(""), null);
  assert.equal(parseTranscriptLine("   \n"), null);
});

test("returns null for malformed JSON instead of throwing", () => {
  assert.equal(parseTranscriptLine("{not valid json"), null);
});

test("parses an assistant text line and extracts a preview", () => {
  const line = JSON.stringify({
    type: "assistant",
    uuid: "u1",
    parentUuid: "p1",
    sessionId: "s1",
    timestamp: "2026-08-06T00:00:00.000Z",
    isSidechain: false,
    cwd: "/tmp/proj",
    gitBranch: "main",
    version: "2.1.223",
    message: {
      id: "msg_1",
      model: "claude-sonnet-5",
      role: "assistant",
      content: [{ type: "text", text: "Hello   world" }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    },
  });

  const entry = parseTranscriptLine(line);
  assert.ok(entry);
  assert.equal(entry.type, "assistant");
  assert.equal(entry.model, "claude-sonnet-5");
  assert.equal(entry.messageId, "msg_1");
  assert.equal(entry.preview, "Hello world");
  assert.deepEqual(entry.usage, {
    inputTokens: 10,
    outputTokens: 5,
    cacheCreationInputTokens: 2,
    cacheReadInputTokens: 3,
  });
});

test("prefers a text block over a tool_use block for preview", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Bash", input: {} },
        { type: "text", text: "explaining first" },
      ],
    },
  });
  const entry = parseTranscriptLine(line);
  assert.equal(entry?.preview, "explaining first");
});

test("falls back to a tool_use preview when there is no text block", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "x" } }] },
  });
  const entry = parseTranscriptLine(line);
  assert.equal(entry?.preview, "→ Read");
});

test("parses a user string-content line", () => {
  const line = JSON.stringify({ type: "user", message: { role: "user", content: "hi there" } });
  const entry = parseTranscriptLine(line);
  assert.equal(entry?.type, "user");
  assert.equal(entry?.preview, "hi there");
});

test("does not extract a preview from a user tool_result line", () => {
  const line = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "output text" }] },
  });
  const entry = parseTranscriptLine(line);
  assert.equal(entry?.preview, undefined);
});

test("classifies unrecognized types as 'other' rather than dropping the line", () => {
  const line = JSON.stringify({ type: "ai-title", aiTitle: "Some title", sessionId: "s1" });
  const entry = parseTranscriptLine(line);
  assert.ok(entry);
  assert.equal(entry.type, "other");
  assert.equal(entry.sessionId, "s1");
});

test("flags rate-limit lines via isApiErrorMessage", () => {
  const line = JSON.stringify({ type: "assistant", isApiErrorMessage: true, apiErrorStatus: 429 });
  const entry = parseTranscriptLine(line);
  assert.equal(entry?.isError, true);
});

test("null parentUuid is preserved, not coerced to undefined", () => {
  const line = JSON.stringify({ type: "user", parentUuid: null, message: { content: "first" } });
  const entry = parseTranscriptLine(line);
  assert.equal(entry?.parentUuid, null);
});
