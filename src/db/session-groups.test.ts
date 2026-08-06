import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";
import { SqliteSessionGroupsStore, defaultGroupId, defaultGroupName } from "./session-groups.js";

function buildStore(): SqliteSessionGroupsStore {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  return new SqliteSessionGroupsStore(db);
}

test("defaultGroupId/defaultGroupName round-trip a cwd", () => {
  const id = defaultGroupId("/Users/apple/proj");
  assert.equal(id, "cwd:/Users/apple/proj");
  assert.equal(defaultGroupName(id), "/Users/apple/proj");
});

test("defaultGroupName passes a custom (non-cwd-derived) groupId through unchanged", () => {
  assert.equal(defaultGroupName("my-custom-group"), "my-custom-group");
});

test("getOverrides/getNames are empty before anything is set", () => {
  const store = buildStore();
  assert.deepEqual(store.getOverrides(), {});
  assert.deepEqual(store.getNames(), {});
});

test("setOverride moves a session into a group, retrievable via getOverrides", () => {
  const store = buildStore();
  store.setOverride("session-1", "my-custom-group");
  assert.deepEqual(store.getOverrides(), { "session-1": "my-custom-group" });
});

test("setOverride on the same session updates in place rather than duplicating", () => {
  const store = buildStore();
  store.setOverride("session-1", "group-a");
  store.setOverride("session-1", "group-b");
  assert.deepEqual(store.getOverrides(), { "session-1": "group-b" });
});

test("setOverride with null clears a session back to its default group", () => {
  const store = buildStore();
  store.setOverride("session-1", "group-a");
  store.setOverride("session-1", null);
  assert.deepEqual(store.getOverrides(), {});
});

test("setName gives a group a custom display name, updates in place on repeat", () => {
  const store = buildStore();
  store.setName("cwd:/tmp/proj", "My Project");
  assert.deepEqual(store.getNames(), { "cwd:/tmp/proj": "My Project" });
  store.setName("cwd:/tmp/proj", "Renamed Again");
  assert.deepEqual(store.getNames(), { "cwd:/tmp/proj": "Renamed Again" });
});

test("overrides and names are independent -- moving a session doesn't touch names and vice versa", () => {
  const store = buildStore();
  store.setName("group-a", "Team Alpha");
  store.setOverride("session-1", "group-a");
  assert.deepEqual(store.getNames(), { "group-a": "Team Alpha" });
  assert.deepEqual(store.getOverrides(), { "session-1": "group-a" });
});
