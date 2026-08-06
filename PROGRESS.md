# Beacon build status

Working notes for resuming across sessions — this repo has had multiple Claude
Code sessions working in it concurrently (same working directory, not
worktrees), so if you're picking this up fresh: `git pull` first, read
`CLAUDE.md` for architecture/gotchas, then check `git log --oneline` against
the table below since this file can lag actual commits.

Plan file (original design doc): `~/.claude/plans/purrfect-noodling-whisper.md`

## Task status — 9 of 10 done

| # | Task | Status |
|---|------|--------|
| 1 | CLAUDE.md | done |
| 2 | Repo scaffold (CLI, Fastify server, Vite/React web) | done |
| 3 | Discovery read model (`src/server/discovery/`) | done, verified against real live sessions |
| 4 | Transcript service (`src/server/transcripts/`) | done, verified against a real transcript |
| 5 | SQLite + tickets-core + layout table (`src/db/`) | done, wired, verified end-to-end |
| 6 | MCP surfaces (`src/server/mcp/`) | done and wired — in-process SDK server + standalone HTTP `/mcp`, verified with a real external MCP client |
| 7 | Agent supervisor (`src/server/supervisor/`) | done, verified against a real launched agent |
| 8 | Fastify REST + WebSocket (`src/server/routes/`, `src/server/ws.ts`) | done — agents, tickets, layout routes + WS, all wired and verified |
| 9 | React web UI (`web/`) | **done** — session detail view (`web/src/pages/SessionDetail.tsx`) + fleet board (`web/src/pages/FleetBoard.tsx`, drag-and-drop via dnd-kit) wired together in `App.tsx` |
| 10 | End-to-end verification | **in progress** — the only thing left |

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

This boots the full, real, fully-wired app — server and web UI both:
- A fleet board at `/` showing every live Claude Code session on the machine
  as a draggable tile (2s poll of `GET /api/sessions`, file-watcher + `claude
  agents --json --all` reconcile server-side). Drag to reposition; drag one
  tile onto another to nest it (one level deep), persisted via `/api/layout`.
- Click a tile to open session detail alongside it: live transcript
  (`GET /api/sessions/:id/transcript?offset=N`, incremental), and for
  Beacon-owned agents, a prompt box, interrupt/kill buttons, and permission-
  approval cards pushed live over `/ws`.
- A "Launch agent" box on the fleet board to start a new Beacon-owned agent
  in any directory (`POST /api/agents`).
- Adopt-via-resume for external sessions via `POST /api/sessions/:id/adopt`
  (not yet wired into the UI — API-only for now, see next steps).
- Full ticket CRUD at `/api/tickets`, backed by SQLite (`~/.beacon/beacon.db`,
  `node:sqlite`, no native build step) — not yet wired into the UI (no ticket
  board view exists yet, see next steps).
- A real MCP server at `POST /mcp` — point any external `claude` session at
  it (`.mcp.json` → `{"mcpServers":{"beacon":{"type":"http","url":"http://127.0.0.1:4317/mcp"}}}`)
  and it can create/update/list tickets directly. Beacon-owned agents get the
  same tools in-process automatically.
- Shuts down cleanly on Ctrl+C, opens the dashboard in your browser
  automatically (`--no-open` to skip).

`pnpm test` runs 82 passing tests (`node --test` via `tsx`).

## What task #10 (end-to-end verification) still needs

The plan's verification checklist, now that everything is built:

1. ~~Launch/prompt/interrupt/kill from the actual browser UI~~ — done, see
   fleet-board commit (real pointer-event-driven browser testing).
2. ~~Confirm the drag-to-nest fleet board persists through `/api/layout`~~ —
   done, same commit.
3. **Adopt an external session from the UI** — API path
   (`POST /api/sessions/:id/adopt`) is verified for real (see below), but
   there's no button for it in the fleet board yet. Either add one, or
   explicitly decide it's API-only for v1 and note that in the README.
4. **Ticket board UI** — `/api/tickets` is fully real and verified via MCP +
   REST, but nothing in `web/` renders it yet. No visible way today to see
   tickets an agent created except `curl`. Worth a small view before calling
   v1 done, even a plain list.
5. Confirm the MCP HTTP endpoint really works from the actual UI's vantage
   point too, not just curl/a test script (i.e. launch an agent from the
   browser, have it create a ticket via the in-process MCP tools, confirm it
   shows up — needs #4 first to have somewhere to see it).
6. `git status` clean of secrets/db files before any release-facing commit.

## Real bugs found and fixed along the way (worth knowing about)

All caught by tests or real end-to-end runs, not by typecheck — the
standing lesson: keep verifying against real behavior everywhere in this
repo, per the note at the bottom of this file.

- `listTickets` sorted by `created_at DESC` alone; two tickets created in the
  same millisecond sorted in undefined order. Fixed with `id DESC` tiebreaker.
- tsup/esbuild silently mangled a static `import ... from "node:sqlite"` into
  the invalid specifier `"sqlite"` in the bundled output — no build/typecheck
  error, only a runtime `ERR_MODULE_NOT_FOUND`. Fixed with `createRequire`.
  Detail in `CLAUDE.md`'s "Build & runtime gotchas".
- `verifyProcStart` (adopt-via-resume's PID-reuse guard) compared Claude
  Code's recorded `procStart` (UTC) against `ps -o lstart=` (local timezone)
  as strings — always mismatched outside UTC, silently breaking
  adopt-via-resume on every non-UTC machine. Only found by actually running
  adopt against a real external session. Fixed and covered by tests.
- Fleet board: nesting was allowed to arbitrary depth, but the renderer only
  draws top-level tiles + direct children — a tile nested two levels deep
  vanished from the UI entirely. Fixed by refusing to nest under an
  already-nested tile, or to nest a tile that itself has children.
- Fleet board: default grid positions were computed from array index into
  the server's session list, whose order isn't guaranteed stable between
  polls — never-dragged tiles would jitter between grid slots. Fixed by
  sorting tile ids first.
- Also verified working correctly, not bugs: the non-loopback bearer-token
  auth gate (401/401/200 across a wrong token, no token, correct token, and
  confirmed it applies globally not just to one route), and full
  adopt-via-resume against a genuine external `claude --bg` session (pid
  killed, resumed session confirmed same Claude Code session id with real
  appended history).

## A tooling note for whoever does browser-based verification next

The `computer` tool's synthetic `left_click_drag` does **not** reliably
trigger dnd-kit's `PointerSensor` — it doesn't appear to generate a proper
native `pointerdown`/`pointermove`/`pointerup` sequence, and produced
confusing, non-reproducible results (phantom writes to unrelated tiles, or
nothing at all) that briefly looked like real app bugs but weren't. For
anything drag-and-drop, dispatch real `PointerEvent`s via
`mcp__claude-in-chrome__javascript_tool` instead — see the fleet-board
commit message for the exact pattern used.

## Notes on how this repo is being built

- Multiple sessions share this literal working directory — not git
  worktrees. Expect to see files change under you mid-session; that's
  normal, not corruption. Only stage/commit files you actually own for the
  task at hand (`git add <specific paths>`, never `git add -A`).
- Everything claimed "done" above was verified against real behavior, not
  just `tsc --noEmit` — real launched agents, real MCP handshakes, real
  live transcripts on this machine, real HTTP round-trips against a real
  SQLite database, real pointer-driven browser interaction. Keep that bar;
  it's caught five real bugs already (see above).
- No Claude co-author trailer in commits; author stays the human user.
