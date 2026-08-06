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
| 5 | SQLite + tickets-core + layout table (`src/db/`) | **in progress elsewhere — not yet pushed as of last check** |
| 6 | MCP surfaces (`src/server/mcp/`) | done, verified with a real MCP client/server handshake |
| 7 | Agent supervisor (`src/server/supervisor/`) | done, verified against a real launched agent |
| 8 | Fastify REST + WebSocket (`src/server/routes/`, `src/server/ws.ts`) | **core done and verified** (agents + WS). Ticket/layout routes deliberately not wired yet — blocked on #5 landing, see below |
| 9 | React web UI (`web/`) | **in progress elsewhere — not yet pushed as of last check** |
| 10 | End-to-end verification | not started — depends on 5, 8 (ticket wiring), 9 |

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

This boots a real server that:
- Lists every live Claude Code session on the machine at `GET /api/sessions`
  (file-watcher + `claude agents --json --all` reconcile)
- Streams a session's transcript incrementally at
  `GET /api/sessions/:id/transcript?offset=N`
- Launches/prompts/interrupts/kills real Beacon-owned agents via
  `POST /api/agents`, `POST /api/agents/:id/prompt`, etc.
- Adopts an external session via `POST /api/sessions/:sessionId/adopt`
- Pushes all of the above live over `ws://.../ws`
- Serves the (currently placeholder) built web app at `/`

## Immediate next steps, in order

1. **Land #5** (tickets-core + layout) if not already in — it unblocks
   wiring `/api/tickets` and `/api/layout` into `src/server/index.ts`
   (small commit, the routes just need to import the real module instead
   of nothing).
2. **Land #9** (fleet board UI) — currently the web app is just a
   health-check placeholder (`web/src/App.tsx`).
3. **Wire the MCP HTTP endpoint into the server** — `registerTicketsMcpRoute`
   exists (`src/server/mcp/http-server.ts`) but is not yet called from
   `src/server/index.ts`. Needs the same real `tickets-core` as #1 above.
4. Task #10: run the full verification checklist from the plan file once
   5+8+9 are in.

## Open parallel slice (safe to hand to a new session right now)

**Session detail view** — live transcript pane, prompt box, permission-
approval cards. All the backend it needs already exists and is verified:
`GET /api/sessions/:id/transcript?offset=N`, `POST /api/agents/:id/prompt`,
`POST /api/agents/:id/interrupt`, `POST /api/agents/:id/permissions/:requestId`,
and the `/ws` channel (messages tagged `{type: "agent-event", agentId, event}`
where `event.kind` is `"message" | "permission-request" | "closed"`).

To avoid colliding with whoever's building the fleet board in `web/`, this
should live in its own files — e.g. `web/src/pages/SessionDetail.tsx` plus
whatever child components it needs — and should NOT edit `web/src/App.tsx`
or any fleet-board component without checking git log first for what exists.

Prompt to hand a fresh session:

> `git pull` the `beacon-fleet` repo (github.com/aydaultani/beacon-fleet).
> Read `CLAUDE.md` and `PROGRESS.md` first. Someone else may be mid-work on
> the fleet board in `web/` — check `git log --oneline -20` before touching
> any file already there, and build in new files, not existing ones.
>
> Build a session detail view: `web/src/pages/SessionDetail.tsx` (or
> similar). Given a session/agent id, it should show:
> - The live transcript, fetched via `GET /api/sessions/:id/transcript?offset=0`
>   then polling/websocket-updating with the returned `nextOffset` for
>   subsequent reads (each entry has `type`, `preview`, `timestamp`, `model`,
>   `usage`, etc. — see `TranscriptEntry` in `src/server/transcripts/types.ts`).
> - A prompt box that POSTs to `/api/agents/:id/prompt` with `{text}` —
>   only works for Beacon-owned agents (an id returned from
>   `POST /api/agents`), not arbitrary discovered sessionIds.
> - An interrupt button (`POST /api/agents/:id/interrupt`) and kill button
>   (`POST /api/agents/:id/kill`).
> - Permission-request cards: listen on `ws://<host>/ws` for messages
>   shaped `{type: "agent-event", agentId, event: {kind: "permission-request",
>   request: {id, toolName, input, title, displayName?, description?}}}`,
>   render a card with the title/description and allow/deny buttons, and on
>   click POST `/api/agents/:id/permissions/:requestId` with
>   `{choice: "once" | "always" | "deny"}`.
>
> Typecheck (`cd web && npx tsc -b`) before committing. Commit and push to
> `main` when done — normal authorship, no Claude co-author trailer, commit
> messages describing what changed and why.

## Notes on how this repo is being built

- Multiple sessions share this literal working directory — not git
  worktrees. Expect to see files change under you mid-session; that's
  normal, not corruption. Only stage/commit files you actually own for the
  task at hand (`git add <specific paths>`, never `git add -A`).
- Everything claimed "done" above was verified against real behavior, not
  just `tsc --noEmit` — real launched agents, real MCP handshakes, real
  live transcripts on this machine. Keep that bar.
- No Claude co-author trailer in commits; author stays the human user.
