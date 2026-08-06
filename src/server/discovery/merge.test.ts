import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSessions } from "./merge.js";
import type { SessionRegistryEntry } from "./registry.js";
import type { JobStateEntry } from "./jobs.js";
import type { CliAgentEntry } from "./reconcile.js";
import type { DiscoveredSession } from "./types.js";

function only(sessions: DiscoveredSession[]): DiscoveredSession {
  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.ok(session);
  return session;
}

test("a registry-only session is alive, unreconciled, sourced from sessions-registry", () => {
  const registry: SessionRegistryEntry[] = [
    { pid: process.pid, sessionId: "s1", cwd: "/tmp/a", kind: "interactive", name: "s1", status: "idle" },
  ];
  const session = only(mergeSessions(registry, [], []));
  assert.equal(session.sessionId, "s1");
  assert.equal(session.alive, true);
  assert.equal(session.reconciled, false);
  assert.deepEqual(session.sources, ["sessions-registry"]);
});

test("a dead pid in the registry is reported as not alive, not just missing", () => {
  const registry: SessionRegistryEntry[] = [{ pid: 999999999, sessionId: "s1", cwd: "/tmp/a", kind: "bg", name: "s1" }];
  const session = only(mergeSessions(registry, [], []));
  assert.equal(session.alive, false);
});

test("jobs enrich a matching registry session instead of duplicating it", () => {
  const registry: SessionRegistryEntry[] = [{ pid: process.pid, sessionId: "s1", cwd: "/tmp/a", kind: "bg", name: "s1" }];
  const jobs: JobStateEntry[] = [{ short: "abcd1234", sessionId: "s1", state: "working", tokens: 42, detail: "doing stuff" }];
  const session = only(mergeSessions(registry, jobs, []));
  assert.equal(session.tokens, 42);
  assert.equal(session.jobState, "working");
  assert.deepEqual(session.sources, ["sessions-registry", "jobs"]);
});

test("a job with no matching registry entry creates its own record with pid null", () => {
  const jobs: JobStateEntry[] = [{ short: "abcd1234", sessionId: "s2", cwd: "/tmp/b", state: "done" }];
  const session = only(mergeSessions([], jobs, []));
  assert.equal(session.sessionId, "s2");
  assert.equal(session.pid, null);
  assert.equal(session.alive, false);
});

test("a jobs entry with no sessionId is skipped, not turned into an invalid record", () => {
  const jobs: JobStateEntry[] = [{ short: "abcd1234", state: "working" }];
  assert.equal(mergeSessions([], jobs, []).length, 0);
});

test("cli reconcile fills in a missing pid for a jobs-only session and marks it reconciled", () => {
  const jobs: JobStateEntry[] = [{ short: "abcd1234", sessionId: "s1", cwd: "/tmp/a", state: "working" }];
  const cliAgents: CliAgentEntry[] = [
    { sessionId: "s1", cwd: "/tmp/a", kind: "background", startedAt: Date.now(), name: "s1", pid: process.pid, status: "busy" },
  ];
  const session = only(mergeSessions([], jobs, cliAgents));
  assert.equal(session.pid, process.pid);
  assert.equal(session.alive, true);
  assert.equal(session.reconciled, true);
  assert.equal(session.status, "busy");
});

test("a cli-only session with no file-based counterpart creates its own reconciled record", () => {
  const cliAgents: CliAgentEntry[] = [{ sessionId: "s3", cwd: "/tmp/c", kind: "interactive", startedAt: Date.now(), name: "s3" }];
  const session = only(mergeSessions([], [], cliAgents));
  assert.equal(session.sessionId, "s3");
  assert.equal(session.kind, "interactive");
  assert.equal(session.reconciled, true);
  // No pid on the cli-only entry means we can't verify liveness — treat as
  // alive rather than guessing dead, since the CLI itself reported it live.
  assert.equal(session.alive, true);
});
