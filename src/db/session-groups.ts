import type { DatabaseSync } from "node:sqlite";

/** Default groupId for a session that's never been explicitly moved --
 * one group per cwd, so "same path = same group" is free without needing
 * a row in either table. Prefixed so it can never collide with a
 * user-chosen custom group id. */
export function defaultGroupId(cwd: string): string {
  return `cwd:${cwd}`;
}

export function defaultGroupName(groupId: string): string {
  return groupId.startsWith("cwd:") ? groupId.slice(4) : groupId;
}

/**
 * Beacon's own grouping of sessions for the sidebar -- distinct from
 * Claude Code's real process/subagent hierarchy (see transcripts/
 * subagents.ts for that). A session's effective group is its override if
 * one exists, otherwise a group derived from its cwd. Overrides are what
 * let a session be moved into a group that isn't its own path.
 */
export class SqliteSessionGroupsStore {
  constructor(private readonly db: DatabaseSync) {}

  /** sessionId -> explicit group override. Sessions with no row here fall
   * back to their cwd-derived default group -- computed by the caller,
   * which knows the live session list; this store only has overrides. */
  getOverrides(): Record<string, string> {
    const rows = this.db.prepare(`SELECT session_id, group_id FROM session_group_overrides`).all() as {
      session_id: string;
      group_id: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.session_id, r.group_id]));
  }

  /** groupId -> custom display name, only for groups that have ever been
   * renamed (including a default cwd-group given a friendlier name). */
  getNames(): Record<string, string> {
    const rows = this.db.prepare(`SELECT group_id, name FROM session_group_names`).all() as {
      group_id: string;
      name: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.group_id, r.name]));
  }

  /** Move a session into groupId, or clear its override (back to its
   * cwd-derived default) when groupId is null. */
  setOverride(sessionId: string, groupId: string | null): void {
    if (groupId === null) {
      this.db.prepare(`DELETE FROM session_group_overrides WHERE session_id = ?`).run(sessionId);
      return;
    }
    this.db
      .prepare(`
        INSERT INTO session_group_overrides (session_id, group_id)
        VALUES (?, ?)
        ON CONFLICT(session_id) DO UPDATE SET group_id = excluded.group_id
      `)
      .run(sessionId, groupId);
  }

  setName(groupId: string, name: string): void {
    this.db
      .prepare(`
        INSERT INTO session_group_names (group_id, name)
        VALUES (?, ?)
        ON CONFLICT(group_id) DO UPDATE SET name = excluded.name
      `)
      .run(groupId, name);
  }
}
