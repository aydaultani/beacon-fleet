import { isPidAlive } from "./liveness.js";
import { mapCliKind, type CliAgentEntry } from "./reconcile.js";
import type { JobStateEntry } from "./jobs.js";
import type { SessionRegistryEntry } from "./registry.js";
import type { DiscoveredSession } from "./types.js";

/**
 * Merges the three discovery sources into one record per sessionId.
 * `sessions-registry` is the primary source (it alone carries verified
 * liveness); `jobs` enriches background sessions with tokens/state; a
 * `cli-reconcile` pass fills in anything the file-based sources missed and
 * marks every session it also saw as `reconciled`.
 */
export function mergeSessions(
  registry: SessionRegistryEntry[],
  jobs: JobStateEntry[],
  cliAgents: CliAgentEntry[],
): DiscoveredSession[] {
  const bySessionId = new Map<string, DiscoveredSession>();

  for (const entry of registry) {
    bySessionId.set(entry.sessionId, {
      sessionId: entry.sessionId,
      pid: entry.pid,
      cwd: entry.cwd,
      kind: entry.kind,
      name: entry.name ?? entry.sessionId,
      status: entry.status ?? "unknown",
      waitingFor: entry.waitingFor,
      alive: isPidAlive(entry.pid),
      sources: ["sessions-registry"],
      jobId: entry.jobId ?? entry.parkedJobId,
      version: entry.version,
      startedAt: entry.startedAt,
      updatedAt: entry.updatedAt,
      procStart: entry.procStart,
      reconciled: false,
    });
  }

  for (const job of jobs) {
    if (!job.sessionId) continue;
    const existing = bySessionId.get(job.sessionId);
    if (existing) {
      existing.jobId = job.short;
      existing.jobState = job.state;
      existing.jobDetail = job.detail ?? job.needs;
      existing.tokens = job.tokens;
      existing.sources.push("jobs");
    } else {
      bySessionId.set(job.sessionId, {
        sessionId: job.sessionId,
        pid: null,
        cwd: job.cwd ?? "",
        kind: "bg",
        name: job.name ?? job.short,
        status: "unknown",
        alive: false,
        sources: ["jobs"],
        jobId: job.short,
        jobState: job.state,
        jobDetail: job.detail ?? job.needs,
        tokens: job.tokens,
        reconciled: false,
      });
    }
  }

  for (const agent of cliAgents) {
    const existing = bySessionId.get(agent.sessionId);
    if (existing) {
      existing.reconciled = true;
      existing.sources.push("cli-reconcile");
      if (agent.status) existing.status = agent.status;
      if (agent.state) existing.jobState = agent.state;
      if (existing.pid === null && agent.pid) {
        existing.pid = agent.pid;
        existing.alive = isPidAlive(agent.pid);
      }
    } else {
      const pid = agent.pid ?? null;
      bySessionId.set(agent.sessionId, {
        sessionId: agent.sessionId,
        pid,
        cwd: agent.cwd,
        kind: mapCliKind(agent.kind),
        name: agent.name,
        status: agent.status ?? "unknown",
        alive: pid !== null ? isPidAlive(pid) : true,
        sources: ["cli-reconcile"],
        jobId: agent.id,
        jobState: agent.state,
        startedAt: agent.startedAt,
        reconciled: true,
      });
    }
  }

  return Array.from(bySessionId.values());
}
