import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import Fastify from "fastify";
import { runMigrations } from "../../db/migrations.js";
import { SqliteTicketsCore } from "../../db/tickets-core.js";
import { registerTicketRoutes } from "./tickets.js";

// Same pattern as agents.test.ts: a real in-memory SQLite store (cheap,
// no file on disk) rather than a mock, so these exercise real query/param
// binding, not a stand-in for it.
function buildApp() {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const app = Fastify({ logger: false });
  registerTicketRoutes(app, new SqliteTicketsCore(db));
  return app;
}

test("GET /api/tickets on a fresh store is an empty array", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/tickets" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
});

test("POST /api/tickets without title or project is rejected with 400", async () => {
  const app = buildApp();
  const missingBoth = await app.inject({ method: "POST", url: "/api/tickets", payload: {} });
  assert.equal(missingBoth.statusCode, 400);
  assert.deepEqual(missingBoth.json(), { error: "title and project are required" });

  const missingProject = await app.inject({ method: "POST", url: "/api/tickets", payload: { title: "T" } });
  assert.equal(missingProject.statusCode, 400);
});

test("POST /api/tickets creates a ticket and GET /api/tickets/:id reads it back", async () => {
  const app = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/api/tickets",
    payload: { title: "Fix the thing", project: "/tmp/proj" },
  });
  assert.equal(created.statusCode, 201);
  const ticket = created.json();
  assert.equal(ticket.title, "Fix the thing");
  assert.equal(ticket.status, "open");

  const fetched = await app.inject({ method: "GET", url: `/api/tickets/${ticket.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json(), ticket);
});

test("GET /api/tickets/:id for an unknown id 404s", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/tickets/999" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "unknown ticket" });
});

test("PATCH /api/tickets/:id updates only the given fields", async () => {
  const app = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/api/tickets",
    payload: { title: "T", body: "orig", project: "/tmp/proj" },
  });
  const id = created.json().id;

  const patched = await app.inject({
    method: "PATCH",
    url: `/api/tickets/${id}`,
    payload: { status: "in_progress" },
  });
  assert.equal(patched.statusCode, 200);
  const ticket = patched.json();
  assert.equal(ticket.status, "in_progress");
  assert.equal(ticket.body, "orig");
});

test("PATCH /api/tickets/:id on an unknown id 404s instead of throwing raw", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "PATCH", url: "/api/tickets/999", payload: { status: "done" } });
  assert.equal(res.statusCode, 404);
  assert.ok(typeof res.json().error === "string");
});

test("DELETE /api/tickets/:id deletes once, then 404s on repeat", async () => {
  const app = buildApp();
  const created = await app.inject({ method: "POST", url: "/api/tickets", payload: { title: "T", project: "p" } });
  const id = created.json().id;

  const first = await app.inject({ method: "DELETE", url: `/api/tickets/${id}` });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { ok: true });

  const second = await app.inject({ method: "DELETE", url: `/api/tickets/${id}` });
  assert.equal(second.statusCode, 404);
});

test("GET /api/tickets?status= filters via query string, same as listTickets", async () => {
  const app = buildApp();
  const a = await app.inject({ method: "POST", url: "/api/tickets", payload: { title: "A", project: "p" } });
  await app.inject({ method: "POST", url: "/api/tickets", payload: { title: "B", project: "p" } });
  await app.inject({ method: "PATCH", url: `/api/tickets/${a.json().id}`, payload: { status: "done" } });

  const res = await app.inject({ method: "GET", url: "/api/tickets?status=open" });
  assert.equal(res.statusCode, 200);
  const tickets = res.json();
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].title, "B");
});
