import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSubagents, readSubagentTranscriptSince } from "./subagents.js";
import { mangleProjectPath } from "../discovery/projects.js";

async function withProjectsDir(run: (baseDir: string, cwd: string, sessionId: string) => Promise<void>): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "beacon-subagents-test-"));
  const cwd = "/tmp/some-project";
  const sessionId = "session-abc";
  try {
    await run(baseDir, cwd, sessionId);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
}

test("listSubagents is empty when the session has no subagents dir at all", () =>
  withProjectsDir(async (baseDir, cwd, sessionId) => {
    assert.deepEqual(await listSubagents(cwd, sessionId, baseDir), []);
  }));

test("listSubagents finds real agent-*.jsonl files, ignores unrelated files", () =>
  withProjectsDir(async (baseDir, cwd, sessionId) => {
    const dir = join(baseDir, mangleProjectPath(cwd), sessionId, "subagents");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "agent-one.jsonl"), '{"type":"user"}\n');
    await writeFile(join(dir, "agent-two.jsonl"), '{"type":"user"}\n');
    await writeFile(join(dir, "not-an-agent.txt"), "irrelevant");

    const summaries = await listSubagents(cwd, sessionId, baseDir);
    const ids = summaries.map((s) => s.agentId).sort();
    assert.deepEqual(ids, ["one", "two"]);
    assert.ok(summaries.every((s) => typeof s.lastActivity === "number" && s.lastActivity > 0));
  }));

test("readSubagentTranscriptSince reads real entries from the agent's own file", () =>
  withProjectsDir(async (baseDir, cwd, sessionId) => {
    const dir = join(baseDir, mangleProjectPath(cwd), sessionId, "subagents");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "agent-abc123.jsonl"), '{"type":"assistant","uuid":"u1"}\n');

    const page = await readSubagentTranscriptSince(cwd, sessionId, "abc123", 0, baseDir);
    assert.equal(page.entries.length, 1);
    assert.equal(page.entries[0]?.type, "assistant");
  }));

test("readSubagentTranscriptSince on a nonexistent agent returns an empty page, not an error", () =>
  withProjectsDir(async (baseDir, cwd, sessionId) => {
    const page = await readSubagentTranscriptSince(cwd, sessionId, "does-not-exist", 0, baseDir);
    assert.deepEqual(page.entries, []);
  }));
