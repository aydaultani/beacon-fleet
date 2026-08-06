import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLinesSince } from "./tail.js";

async function withTempFile(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "beacon-tail-test-"));
  const path = join(dir, "transcript.jsonl");
  try {
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("reads every complete line on the first call", () =>
  withTempFile(async (path) => {
    await writeFile(path, "line1\nline2\nline3\n");
    const result = await readLinesSince(path, 0);
    assert.deepEqual(result.lines, ["line1", "line2", "line3"]);
    assert.equal(result.nextOffset, result.fileSize);
  }));

test("a second call from nextOffset returns nothing new when the file is unchanged", () =>
  withTempFile(async (path) => {
    await writeFile(path, "line1\nline2\n");
    const first = await readLinesSince(path, 0);
    const second = await readLinesSince(path, first.nextOffset);
    assert.deepEqual(second.lines, []);
    assert.equal(second.nextOffset, first.nextOffset);
  }));

test("picks up only appended lines on a subsequent call", () =>
  withTempFile(async (path) => {
    await writeFile(path, "line1\n");
    const first = await readLinesSince(path, 0);
    await appendFile(path, "line2\nline3\n");
    const second = await readLinesSince(path, first.nextOffset);
    assert.deepEqual(second.lines, ["line2", "line3"]);
  }));

test("holds back a trailing partial line instead of yielding truncated content", () =>
  withTempFile(async (path) => {
    await writeFile(path, "complete\n{\"partial\": tr");
    const result = await readLinesSince(path, 0);
    assert.deepEqual(result.lines, ["complete"]);
    // nextOffset must point at the start of the partial line, not EOF, so
    // the next call re-reads and completes it instead of losing it.
    assert.equal(result.nextOffset, Buffer.byteLength("complete\n", "utf8"));

    await appendFile(path, "ue}\n");
    const second = await readLinesSince(path, result.nextOffset);
    assert.deepEqual(second.lines, ['{"partial": true}']);
  }));

test("offset beyond current file size yields nothing rather than erroring", () =>
  withTempFile(async (path) => {
    await writeFile(path, "line1\n");
    const result = await readLinesSince(path, 999);
    assert.deepEqual(result.lines, []);
    assert.equal(result.nextOffset, 999);
  }));

test("rejects with ENOENT for a missing file so callers can distinguish 'no file yet' from a parse error", () =>
  withTempFile(async (path) => {
    await assert.rejects(readLinesSince(join(path, "..", "does-not-exist.jsonl"), 0), (err: NodeJS.ErrnoException) => {
      assert.equal(err.code, "ENOENT");
      return true;
    });
  }));
