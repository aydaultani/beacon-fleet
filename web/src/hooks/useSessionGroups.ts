import { useCallback, useEffect, useState } from "react";
import type { DiscoveredSession } from "./useSessions.js";

export interface SessionGroup {
  groupId: string;
  name: string;
  sessions: DiscoveredSession[];
}

function defaultGroupId(cwd: string): string {
  return `cwd:${cwd}`;
}

function defaultGroupName(groupId: string): string {
  return groupId.startsWith("cwd:") ? groupId.slice(4) : groupId;
}

export interface UseSessionGroupsResult {
  groups: SessionGroup[];
  groupIdOf: (sessionId: string) => string;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  moveSessionToGroup: (sessionId: string, groupId: string | null) => Promise<void>;
}

/** Joins the small server-side override/name maps against the live
 * session list to compute each session's effective group — see
 * src/db/session-groups.ts for why the split is server-maps +
 * client-join rather than the server trying to own "sessions" as a
 * concept it doesn't otherwise track. */
export function useSessionGroups(sessions: DiscoveredSession[]): UseSessionGroupsResult {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const res = await fetch("/api/session-groups");
    if (!res.ok) return;
    const body: { overrides: Record<string, string>; names: Record<string, string> } = await res.json();
    setOverrides(body.overrides);
    setNames(body.names);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groupIdOf = useCallback((sessionId: string): string => {
    const session = sessions.find((s) => s.sessionId === sessionId);
    return overrides[sessionId] ?? (session ? defaultGroupId(session.cwd) : sessionId);
  }, [sessions, overrides]);

  const byGroup = new Map<string, DiscoveredSession[]>();
  for (const session of sessions) {
    const groupId = overrides[session.sessionId] ?? defaultGroupId(session.cwd);
    const list = byGroup.get(groupId) ?? [];
    list.push(session);
    byGroup.set(groupId, list);
  }

  const groups: SessionGroup[] = Array.from(byGroup.entries())
    .map(([groupId, groupSessions]) => ({
      groupId,
      name: names[groupId] ?? defaultGroupName(groupId),
      sessions: groupSessions,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const renameGroup = useCallback(
    async (groupId: string, name: string) => {
      await fetch(`/api/session-groups/group/${encodeURIComponent(groupId)}/name`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refresh();
    },
    [refresh],
  );

  const moveSessionToGroup = useCallback(
    async (sessionId: string, groupId: string | null) => {
      await fetch(`/api/session-groups/${encodeURIComponent(sessionId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      await refresh();
    },
    [refresh],
  );

  return { groups, groupIdOf, renameGroup, moveSessionToGroup };
}
