import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MachineUsageTracker } from "./machine-usage.js";

function usageLine(messageId: string, inputTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    message: { id: messageId, usage: { input_tokens: inputTokens, output_tokens: outputTokens } },
  });
}

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "beacon-machine-usage-test-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("sums usage across multiple transcript files, including nested subagent transcripts", () =>
  withTempRoot(async (root) => {
    const projectDir = join(root, "-Users-apple-proj");
    const subagentsDir = join(projectDir, "sess-1", "subagents");
    await mkdir(subagentsDir, { recursive: true });

    await writeFile(join(projectDir, "sess-1.jsonl"), `${usageLine("m1", 10, 5)}\n`);
    await writeFile(join(subagentsDir, "agent-1.jsonl"), `${usageLine("m2", 20, 15)}\n`);

    const tracker = new MachineUsageTracker(root);
    const totals = await tracker.scan();

    assert.equal(totals.inputTokens, 30);
    assert.equal(totals.outputTokens, 20);
    assert.equal(totals.totalTokens, 50);
  }));

test("dedups repeated message.id lines within one file, same as a single-session sum", () =>
  withTempRoot(async (root) => {
    const projectDir = join(root, "-Users-apple-proj");
    await mkdir(projectDir, { recursive: true });
    const line = usageLine("m1", 100, 50);
    await writeFile(join(projectDir, "sess-1.jsonl"), `${line}\n${line}\n${line}\n`);

    const tracker = new MachineUsageTracker(root);
    const totals = await tracker.scan();

    assert.equal(totals.inputTokens, 100);
    assert.equal(totals.outputTokens, 50);
  }));

test("reuses cached totals for an unchanged file and picks up growth on the next scan", () =>
  withTempRoot(async (root) => {
    const projectDir = join(root, "-Users-apple-proj");
    await mkdir(projectDir, { recursive: true });
    const path = join(projectDir, "sess-1.jsonl");
    await writeFile(path, `${usageLine("m1", 10, 5)}\n`);

    const tracker = new MachineUsageTracker(root);
    const first = await tracker.scan();
    assert.equal(first.inputTokens, 10);

    const second = await tracker.scan();
    assert.equal(second.inputTokens, 10);

    await appendFile(path, `${usageLine("m2", 7, 3)}\n`);
    const third = await tracker.scan();
    assert.equal(third.inputTokens, 17);
    assert.equal(third.outputTokens, 8);
  }));

test("emits an 'update' event with fresh totals after each scan", () =>
  withTempRoot(async (root) => {
    const projectDir = join(root, "-Users-apple-proj");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, "sess-1.jsonl"), `${usageLine("m1", 1, 2)}\n`);

    const tracker = new MachineUsageTracker(root);
    const events: number[] = [];
    tracker.on("update", (totals: { totalTokens: number }) => events.push(totals.totalTokens));

    await tracker.scan();
    assert.deepEqual(events, [3]);
  }));

test("missing root directory yields zeroed totals instead of throwing", () =>
  withTempRoot(async (root) => {
    const tracker = new MachineUsageTracker(join(root, "does-not-exist"));
    const totals = await tracker.scan();
    assert.equal(totals.totalTokens, 0);
  }));
