import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerFsRoutes } from "./fs.js";

function buildApp() {
  const app = Fastify({ logger: false });
  registerFsRoutes(app);
  return app;
}

test("GET /api/fs/list lists only directories, skips dotdirs and files", async () => {
  const root = mkdtempSync(join(tmpdir(), "beacon-fs-test-"));
  mkdirSync(join(root, "beta"));
  mkdirSync(join(root, "alpha"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "not-a-dir.txt"), "x");

  const app = buildApp();
  const res = await app.inject({ method: "GET", url: `/api/fs/list?dir=${encodeURIComponent(root)}` });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.dir, root);
  assert.deepEqual(body.entries.map((e: { name: string }) => e.name), ["alpha", "beta"]);
  assert.equal(body.entries[0].path, join(root, "alpha"));
});

test("GET /api/fs/list with no dir defaults to home and doesn't throw", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/fs/list" });
  assert.equal(res.statusCode, 200);
  assert.ok(typeof res.json().dir === "string");
});

test("GET /api/fs/list on a nonexistent path returns 400, not a crash", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/fs/list?dir=/definitely/not/a/real/path/xyz" });
  assert.equal(res.statusCode, 400);
});

test("parent is null at the filesystem root", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/fs/list?dir=/" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().parent, null);
});
