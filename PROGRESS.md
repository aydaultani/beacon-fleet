# Beacon build status

Working notes for resuming across sessions — this repo has had multiple Claude
Code sessions working in it concurrently (same working directory, not
worktrees), so if you're picking this up fresh: `git pull` first, read
`CLAUDE.md` for architecture/gotchas, then check `git log --oneline` against
the table below since this file can lag actual commits.

Plan file (original design doc): `~/.claude/plans/purrfect-noodling-whisper.md`

## Task status — 10 of 10 done

All ten tasks from the original plan are built, wired together, and verified
against real behavior — real launched agents, a real external MCP client,
real SQLite writes, real HTTP round-trips, a real browser pass against the
production build. Not just typechecked.

| # | Task |
|---|------|
| 1 | CLAUDE.md |
| 2 | Repo scaffold (CLI, Fastify server, Vite/React web) |
| 3 | Discovery read model (`src/server/discovery/`) |
| 4 | Transcript service (`src/server/transcripts/`) |
| 5 | SQLite + tickets-core + layout table (`src/db/`) |
| 6 | MCP surfaces (`src/server/mcp/`) — in-process SDK server + standalone HTTP `/mcp` |
| 7 | Agent supervisor (`src/server/supervisor/`) |
| 8 | Fastify REST + WebSocket (`src/server/routes/`, `src/server/ws.ts`) |
| 9 | React web UI (`web/`) — fleet board, session detail, ticket board, full design system |
| 10 | End-to-end verification |

Also worth knowing: the npm package was renamed `beacon-hq` → `beacon-fleet`
mid-build (npm blocked publishing `beacon-hq` as too similar to an existing
`beaconhq` package). GitHub repo is `aydaultani/beacon-fleet`. If you see a
stray `beacon-hq` reference anywhere, it's stale.

## What's real right now

```
pnpm install
pnpm run build
node bin/beacon-fleet.js --port 4317
```

Boots the full app, server and web UI both:

- **Fleet board** at `/` — every live Claude Code session on the machine as
  a draggable tile (2s poll of `GET /api/sessions`; file-watcher + `claude
  agents --json --all` reconcile server-side). Drag to reposition; drag one
  tile onto another to nest it (one level deep, refuses anything that would
  make a tile vanish from the UI); persisted via `/api/layout`. A path
  picker (browses real directories via `/api/fs`) plus "Launch agent" starts
  a new Beacon-owned agent anywhere.
- **Session detail** (click a tile) — live transcript, and for Beacon-owned
  agents: prompt box, interrupt/kill, permission-approval cards pushed live
  over `/ws`. For a discovered-but-not-owned session: read-only, with an
  **Adopt** button (confirmed) that calls the verified adopt-via-resume path.
- **Ticket board** (`Tickets` tab) — plain kanban (open/in_progress/blocked/
  done) over `/api/tickets`: create, change status/priority, delete.
- **MCP server** at `POST /mcp` — point any external `claude` session at it
  (`.mcp.json` → `{"mcpServers":{"beacon":{"type":"http","url":"http://127.0.0.1:4317/mcp"}}}`)
  and it can create/update/list tickets directly, visible live on the ticket
  board. Beacon-owned agents get the same tools in-process automatically.
- SQLite at `~/.beacon/beacon.db` via `node:sqlite` — no native build step.
- Full dark/light design system (`web/src/theme.css`, `prefers-color-scheme`).
- Clean shutdown on Ctrl+C, opens the browser automatically (`--no-open` to skip).

`pnpm test` runs 86 passing tests (`node --test` via `tsx`).

## Real bugs found and fixed along the way

All caught by tests or real end-to-end runs, not by typecheck — the
standing lesson for whoever works on this next: keep verifying against real
behavior, per the note at the bottom of this file.

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
- Also verified working correctly (not bugs, just untested paths that could
  have been wrong): the non-loopback bearer-token auth gate (401/401/200
  across wrong/missing/correct token, applies globally not just one route);
  full adopt-via-resume against a genuine external `claude --bg` session
  (pid killed, resumed session same Claude Code session id, real history);
  adopt triggered from the actual browser UI end to end; ticket
  create/status-change/delete round-tripping through the real UI.

## A tooling note for future browser-based verification

The `computer` tool's synthetic `left_click_drag` does **not** reliably
trigger dnd-kit's `PointerSensor` — it doesn't generate a proper native
`pointerdown`/`pointermove`/`pointerup` sequence, and produced confusing,
non-reproducible results (phantom writes to unrelated tiles, or nothing at
all) that briefly looked like real app bugs but weren't. For drag-and-drop,
dispatch real `PointerEvent`s via `mcp__claude-in-chrome__javascript_tool`
instead. Separately: never click a button wired to `window.confirm()`
directly in an automated browser session (it blocks the tab) — stub
`window.confirm = () => true` via `javascript_tool` first.

## Possible follow-ups (v1 is done; these are polish, not blockers)

- Fleet board free-positioned tiles can visually overlap when a parent tile
  grows taller after gaining nested children — cosmetic, drag it away.
- Real-time push for the fleet board list itself still polls (2s) rather
  than using the `/ws` "sessions" message type the hub already sends —
  works fine, just not maximally live.
- No tests yet for the new `web/` components (TicketBoard, PathPicker,
  adopt flow) beyond manual browser verification — the server side has 86
  passing tests, the web side has none. Worth adding if this grows further.

## Notes on how this repo is being built

- Multiple sessions share this literal working directory — not git
  worktrees. Expect to see files change under you mid-session; that's
  normal, not corruption. Only stage/commit files you actually own for the
  task at hand (`git add <specific paths>`, never `git add -A`).
- Everything claimed "done" above was verified against real behavior, not
  just `tsc --noEmit`. Keep that bar — it's caught real bugs every time
  it's been applied (see above).
- No Claude co-author trailer in commits; author stays the human user.
