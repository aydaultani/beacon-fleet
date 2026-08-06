# Beacon build status

Working notes for resuming across sessions — this repo has had multiple Claude
Code sessions working in it concurrently (same working directory, not
worktrees), so if you're picking this up fresh: `git pull` first, read
`CLAUDE.md` for architecture/gotchas, then check `git log --oneline` against
the table below since this file can lag actual commits.

Plan file (original design doc): `~/.claude/plans/purrfect-noodling-whisper.md`

## Task status

| # | Task | Status |
|---|------|--------|
| 1 | CLAUDE.md | done |
| 2 | Repo scaffold (CLI, Fastify server, Vite/React web) | done |
| 3 | Discovery read model (`src/server/discovery/`) | done, verified against real live sessions |
| 4 | Transcript service (`src/server/transcripts/`) | done, verified against a real transcript |
| 5 | SQLite + tickets-core + layout table (`src/db/`) | **done**, wired, verified end-to-end |
| 6 | MCP surfaces (`src/server/mcp/`) | **done and wired** — in-process SDK server + standalone HTTP `/mcp`, verified with a real external MCP client |
| 7 | Agent supervisor (`src/server/supervisor/`) | done, verified against a real launched agent |
| 8 | Fastify REST + WebSocket (`src/server/routes/`, `src/server/ws.ts`) | **done** — agents, tickets, layout routes + WS, all wired and verified |
| 9 | React web UI (`web/`) | **in progress elsewhere** — fleet board in `web/`, session detail view in `web/src/pages/SessionDetail.tsx`. Both actively worked as of last check. |
| 10 | End-to-end verification | not started — only remaining blocker is #9 landing |

Also worth knowing: the npm package was renamed `beacon-hq` → `beacon-fleet`
mid-build (npm blocked publishing `beacon-hq` as too similar to an existing
`beaconhq` package). GitHub repo is now `aydaultani/beacon-fleet` too. If you
see a stray `beacon-hq` reference anywhere, it's stale.

## What's real right now (you can run this today)

```
pnpm install
pnpm run build
node bin/beacon-fleet.js --port 4317
```

This boots a real, fully-wired server:
- Lists every live Claude Code session on the machine at `GET /api/sessions`
  (file-watcher + `claude agents --json --all` reconcile)
- Streams a session's transcript incrementally at
  `GET /api/sessions/:id/transcript?offset=N`
- Launches/prompts/interrupts/kills real Beacon-owned agents via
  `POST /api/agents`, `POST /api/agents/:id/prompt`, etc.
- Adopts an external session via `POST /api/sessions/:sessionId/adopt`
- Full ticket CRUD at `/api/tickets` and fleet-board layout at `/api/layout`,
  backed by SQLite (`~/.beacon/beacon.db`, `node:sqlite`, no native build step)
- A real MCP server at `POST /mcp` — point any external `claude` session at it
  (`.mcp.json` → `{"mcpServers":{"beacon":{"type":"http","url":"http://127.0.0.1:4317/mcp"}}}`)
  and it can create/update/list tickets directly. Beacon-owned agents get the
  same tools in-process automatically.
- Pushes all of the above live over `ws://.../ws`
- Serves the built web app at `/` (currently the fleet board + session detail
  work landing from another session — check `web/` for current state)
- Shuts down cleanly on Ctrl+C (stops file watchers, kills owned agents,
  exits 0) and opens the dashboard in your browser automatically
  (`--no-open` to skip)

`pnpm test` runs 64 passing tests (`node --test` via `tsx`) covering
discovery merge logic, transcript parsing/tailing/usage-dedup, the push
queue and permission bridge, ticket/layout persistence and migrations, and
agent-route validation paths.

## Immediate next steps, in order

1. **Land #9** (fleet board UI + session detail view) — the only thing left.
2. Task #10: once #9 is in, run the full verification checklist from the plan
   file — launch/prompt/interrupt/kill from the actual browser UI, adopt an
   external session from the UI, confirm the ticket board updates live when
   an agent creates a ticket via MCP, confirm the drag-to-nest fleet board
   persists through `/api/layout`.

## Two real bugs worth knowing about (in case similar ones lurk elsewhere)

Both were caught by tests or real end-to-end runs, not by typecheck — worth
remembering as a reminder to keep verifying against real behavior, not just
`tsc --noEmit`, per the standing rule below.

- `listTickets` sorted by `created_at DESC` alone. Two tickets created in the
  same millisecond (very plausible for an agent batch-creating a few) sorted
  in undefined order relative to each other. Fixed with `id DESC` as a
  tiebreaker. Caught by a test creating two tickets back-to-back.
- tsup/esbuild silently mangles a static `import ... from "node:sqlite"` into
  the invalid bare specifier `"sqlite"` in the bundled output — no build or
  typecheck error, only a runtime `ERR_MODULE_NOT_FOUND` when the actual CLI
  runs. Worked around with `createRequire` instead of a static import. Full
  detail in `CLAUDE.md`'s "Build & runtime gotchas" section — read that
  before adding another `node:sqlite`-importing file.
- `verifyProcStart` (the PID-reuse guard behind adopt-via-resume) compared
  Claude Code's recorded `procStart` (UTC) against `ps -o lstart=` (local
  timezone) as strings — always mismatching on any machine not in UTC,
  which would have made adopt-via-resume silently unusable outside UTC.
  Only found by actually running adopt against a real external session
  (`claude --bg`), not by the unit tests, since this function had zero test
  coverage before. Fixed and now covered — see `liveness.ts`/`liveness.test.ts`.

Real end-to-end verification done beyond what's listed above: the
non-loopback bearer-token auth gate (no token → 401, wrong token → 401,
correct token → 200, applies globally not just to one route), and
adopt-via-resume against a genuine external `claude --bg` session — original
pid confirmed killed, resumed session confirmed to be the same Claude Code
session id with real appended history, not a fresh one.

## Notes on how this repo is being built

- Multiple sessions share this literal working directory — not git
  worktrees. Expect to see files change under you mid-session; that's
  normal, not corruption. Only stage/commit files you actually own for the
  task at hand (`git add <specific paths>`, never `git add -A`).
- Everything claimed "done" above was verified against real behavior, not
  just `tsc --noEmit` — real launched agents, real MCP handshakes, real
  live transcripts on this machine, real HTTP round-trips against a real
  SQLite database. Keep that bar; it's caught two real bugs already (see
  above).
- No Claude co-author trailer in commits; author stays the human user.
