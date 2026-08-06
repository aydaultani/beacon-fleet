import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";
import { SqliteTicketsCore } from "./tickets-core.js";

function buildStore(): SqliteTicketsCore {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  return new SqliteTicketsCore(db);
}

test("createTicket applies defaults and returns a readable row", async () => {
  const tickets = buildStore();
  const created = await tickets.createTicket({ title: "Fix the thing", project: "/tmp/proj" });
  assert.equal(created.title, "Fix the thing");
  assert.equal(created.status, "open");
  assert.equal(created.priority, "med");
  assert.equal(created.body, "");
  assert.equal(created.assignee, null);
  assert.equal(created.parentId, null);
  assert.ok(created.id > 0);
  assert.equal(created.createdAt, created.updatedAt);
});

test("createTicket honors explicit body/priority/assignee", async () => {
  const tickets = buildStore();
  const created = await tickets.createTicket({
    title: "T",
    body: "details here",
    priority: "high",
    project: "/tmp/proj",
    assignee: "agent-123",
  });
  assert.equal(created.body, "details here");
  assert.equal(created.priority, "high");
  assert.equal(created.assignee, "agent-123");
});

test("getTicket returns undefined for an unknown id, not a thrown error", async () => {
  const tickets = buildStore();
  assert.equal(await tickets.getTicket(999), undefined);
});

test("updateTicket changes only the fields provided", async () => {
  const tickets = buildStore();
  const created = await tickets.createTicket({ title: "T", body: "orig", project: "/tmp/proj" });
  const updated = await tickets.updateTicket(created.id, { status: "in_progress" });

  assert.equal(updated.status, "in_progress");
  assert.equal(updated.title, "T");
  assert.equal(updated.body, "orig");
  assert.ok(updated.updatedAt >= created.updatedAt);
});

test("updateTicket can explicitly clear assignee with null", async () => {
  const tickets = buildStore();
  const created = await tickets.createTicket({ title: "T", project: "/tmp/proj", assignee: "agent-1" });
  const updated = await tickets.updateTicket(created.id, { assignee: null });
  assert.equal(updated.assignee, null);
});

test("updateTicket on an unknown id throws rather than silently creating one", async () => {
  const tickets = buildStore();
  await assert.rejects(tickets.updateTicket(999, { status: "done" }));
});

test("deleteTicket returns true once and false on a repeat delete", async () => {
  const tickets = buildStore();
  const created = await tickets.createTicket({ title: "T", project: "/tmp/proj" });
  assert.equal(await tickets.deleteTicket(created.id), true);
  assert.equal(await tickets.deleteTicket(created.id), false);
  assert.equal(await tickets.getTicket(created.id), undefined);
});

test("listTickets filters by status and project", async () => {
  const tickets = buildStore();
  const a = await tickets.createTicket({ title: "A", project: "/tmp/proj-a" });
  await tickets.createTicket({ title: "B", project: "/tmp/proj-b" });
  await tickets.updateTicket(a.id, { status: "done" });

  const openOnly = await tickets.listTickets({ status: "open" });
  assert.equal(openOnly.length, 1);
  assert.equal(openOnly[0]?.title, "B");

  const projectA = await tickets.listTickets({ project: "/tmp/proj-a" });
  assert.equal(projectA.length, 1);
  assert.equal(projectA[0]?.title, "A");
});

test("listTickets with no filter returns everything, newest first", async () => {
  const tickets = buildStore();
  const first = await tickets.createTicket({ title: "first", project: "/tmp/proj" });
  const second = await tickets.createTicket({ title: "second", project: "/tmp/proj" });
  const all = await tickets.listTickets();
  assert.equal(all.length, 2);
  assert.equal(all[0]?.id, second.id);
  assert.equal(all[1]?.id, first.id);
});

test("parent/child ticket links round-trip through create and update", async () => {
  const tickets = buildStore();
  const parent = await tickets.createTicket({ title: "Epic", project: "/tmp/proj" });
  const child = await tickets.createTicket({ title: "Subtask", project: "/tmp/proj", parentId: parent.id });
  assert.equal(child.parentId, parent.id);

  const reparented = await tickets.createTicket({ title: "Another subtask", project: "/tmp/proj" });
  const updated = await tickets.updateTicket(reparented.id, { parentId: parent.id });
  assert.equal(updated.parentId, parent.id);

  const orphaned = await tickets.updateTicket(child.id, { parentId: null });
  assert.equal(orphaned.parentId, null);
});
