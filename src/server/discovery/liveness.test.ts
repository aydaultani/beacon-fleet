import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { isPidAlive, verifyProcStart } from "./liveness.js";

const execFileAsync = promisify(execFile);

test("the current process is reported alive", () => {
  assert.equal(isPidAlive(process.pid), true);
});

test("an implausible pid is reported not alive", () => {
  assert.equal(isPidAlive(999999999), false);
});

/** Formats an epoch as the ctime-style string Claude Code writes for
 * `procStart` ("Thu Aug  6 08:05:26 2026") — same shape `ps -o lstart=`
 * produces, but this one deliberately in UTC to build a synthetic
 * "recorded" value for the round-trip test below. */
function toCtimeUtcString(epochMs: number): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(epochMs);
  const day = d.getUTCDate();
  const dayStr = day < 10 ? ` ${day}` : `${day}`;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${dayStr} ${hh}:${mm}:${ss} ${d.getUTCFullYear()}`;
}

test("verifyProcStart matches across the UTC-vs-local-timezone gap between Claude Code's recording and ps", async () => {
  // Regression test for a real bug: Claude Code records procStart in UTC,
  // but `ps -o lstart=` reports local time. On a machine not in UTC, a
  // naive string comparison always mismatches — verified against a real
  // process on this machine (IST): recorded "08:05:26" vs ps's "13:35:26"
  // for the SAME process, an exact 5:30 gap. This test would have failed
  // outside UTC before the fix.
  const { stdout } = await execFileAsync("ps", ["-p", String(process.pid), "-o", "lstart="]);
  const liveEpoch = new Date(stdout.trim()).getTime();
  const recordedAsUtc = toCtimeUtcString(liveEpoch);

  assert.equal(await verifyProcStart(process.pid, recordedAsUtc), true);
});

test("verifyProcStart rejects a recorded time far from the process's actual start", async () => {
  const wildlyDifferent = toCtimeUtcString(Date.now() - 999_999_999);
  assert.equal(await verifyProcStart(process.pid, wildlyDifferent), false);
});

test("verifyProcStart returns true (can't verify, don't block) when no recorded value is given", async () => {
  assert.equal(await verifyProcStart(process.pid, undefined), true);
});

test("verifyProcStart returns true (can't verify, don't block) for a syntactically invalid pid", async () => {
  // ps exits non-zero outright for a pid it considers malformed ("process
  // id too large"), landing in the catch-all fail-open path.
  assert.equal(await verifyProcStart(999999999, "Thu Aug 6 08:05:26 2026"), true);
});

test("verifyProcStart also fails open for a pid that has actually exited", async () => {
  // Verified real behavior, not an assumption: on macOS, `ps -p <pid>`
  // exits non-zero with no output once the pid is gone — it does not
  // succeed with blank stdout. So this hits the same catch-all path as
  // the invalid-pid case above, not a dedicated "not found" branch.
  // Callers relying on this to detect "process exited" are calling the
  // wrong function — that's isPidAlive's job (SupervisorManager.adopt()
  // checks it first, before ever calling verifyProcStart).
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  assert.ok(pid);
  await new Promise((resolve) => child.on("exit", resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await verifyProcStart(pid, "Thu Aug 6 08:05:26 2026"), true);
});
