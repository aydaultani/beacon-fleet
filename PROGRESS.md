# Beacon build status

Working notes for resuming across sessions — this repo has had multiple Claude
Code sessions working in it concurrently (same working directory, not
worktrees), so if you're picking this up fresh: `git pull` first, read
`CLAUDE.md` for architecture/gotchas, then check `git log --oneline` against
the table below since this file can lag actual commits.

Plan file (original design doc): `~/.claude/plans/purrfect-noodling-whisper.md`

## Visual identity, take three — and a structural rebuild (2026-08-06, ~21:00)

**STOP building on the current `theme.css` tokens / TUI look. It's rejected
too.** Timeline so far, so nobody repeats a rejected direction a third time:

1. Pass one (`3ea8a74`): soft dark panels, pill chips, rounded cards,
   dot-grid canvas. User hated it on sight.
2. Pass two (`acd5cde`): asked for a reference, got "k9s/lazygit-style
   terminal dashboard" — rebuilt as monospace-everywhere, `radius: 0`,
   bracket tags (`[BUSY]`), blink animation, CRT scanline overlay.
   **Also rejected** — "weird stuff... shabby AI slop... should look clean
   and easy to read."
3. Current direction (in progress now): **minimalistic, clean, fixed
   4-region layout** — explicit ask was "what's on the left/right/up/down,
   make everything fixed." Also a **structural** change, not just visual:
   drop the free-drag/nest tile canvas entirely in favor of a tree/flowchart
   of each session's real Claude Code subagents (Task-tool sub-conversations
   — see `src/server/transcripts/subagents.ts`, new), with right-click
   actions. Layout being built:
   - Top: thin fixed header (brand + Fleet/Tickets).
   - Left: fixed sidebar, flat list of top-level sessions.
   - Center: tree/flowchart canvas — selected session as root, its real
     subagents as children, connected by lines.
   - Right: fixed detail panel — transcript + controls for whichever node
     (session or subagent) is selected.
   - Nothing pinned to the bottom by choice — panels scroll internally.
   - Visual language: calm, minimal, one legible UI font + monospace
     reserved for real paths/ids/code only — no brackets, no blink, no
     scanlines, no heavy borders. Small radius (~6px) is fine; the point is
     restraint and legibility, not another stylistic bit.

**Known hard constraint:** subagents can only be spawned by the model
itself mid-turn (the Task tool) — there is no API to force-spawn one from
outside. "Right-click → launch subagent" can only mean *send a prompt*
nudging the session to delegate, not a direct subagent-spawn call.

If you're mid-work on `FleetBoard.tsx`/`TicketBoard.tsx` styling or the
drag/nest tile canvas right now: that structure is being replaced, not
reskinned — worth checking `git log --oneline -5` before investing more in
it. `web/src/theme.css` is about to be rewritten too.

## Task status — all 10 implemented, still in testing

**Not released, not stable.** All ten tasks from the original plan have been
built, wired together, and each has worked in at least one real test pass —
real launched agents, a real external MCP client, real SQLite writes, real
HTTP round-trips, a real browser pass. That is a higher bar than "typechecks,"
but do not read "implemented" as "done" — real bugs have kept surfacing after
each "verified" pass (see the bug list below, which keeps growing), and the
web UI in particular has no automated tests, only manual spot checks. Treat
this as a working prototype under active bug-fixing, not a finished product.
Release status changes only with the user's explicit sign-off.

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
- **Adopt deadlocked permanently after the "Adopted" banner** — `BeaconSession.sessionId`
  was only ever set from the SDK's `system/init` message (`session.ts`), but the
  underlying `claude` subprocess (streaming-input mode) emits nothing at all —
  including `init` — until the *first* message is pushed into its input queue.
  For adopt-via-resume specifically that's an unbreakable deadlock: the web UI
  only unlocks the prompt box once `agentIdBySessionId` resolves, which needs
  `sessionId`, which never arrived because nothing could be typed to trigger
  it. Verified live: adopted disposable `claude --bg` sessions and polled
  `/api/agents` for 20s+ with zero prompts sent — `sessionId` never appeared.
  Fixed by seeding `this.sessionId = opts.resume` synchronously in the
  `BeaconSession` constructor whenever resuming — that id is already known
  before the subprocess even starts, since resume requires passing it. `pump()`
  still overwrites it if `init` reports something different (the resume
  cwd-mismatch trap in `CLAUDE.md` can silently start a fresh session
  instead). Re-verified live post-fix: `sessionId` present in the very `adopt`
  response, agent linkable with zero prompts sent, and a real follow-up prompt
  against the resumed session round-tripped correctly under the same session
  id. **Same root cause likely also affects plain `Launch agent`** (a fresh
  launch has no `resume` to seed from, so its `sessionId` is probably still
  stuck the same way) — not fixed here since it wasn't the reported bug and
  needs a different fix (no id to seed from), but worth checking next.

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

**Correction/addendum (2026-08-07), for a hand-rolled (non-dnd-kit) drag
implementation that calls `setPointerCapture` in its own `onPointerDown`:**
`javascript_tool`-dispatched synthetic `PointerEvent`s do **not** work here
either, for a different reason than the dnd-kit case above —
`element.setPointerCapture(pointerId)` throws `NotFoundError: No active
pointer with the given id is found` for a pointerId that was never a real
OS-originated pointer, which silently aborts the handler before any state
update runs (looks exactly like "dragging does nothing," easy to mistake
for an app bug). The `computer` tool's `left_click_drag` **does** work
correctly for this case — it's real synthetic OS-level input via CDP, which
the browser does mark as an active pointer. So: dnd-kit's `PointerSensor` ⇒
dispatch raw events yourself; a hand-rolled `setPointerCapture`-based
implementation ⇒ use `left_click_drag` instead. Try both if unsure which
one the code under test uses.

## Session tree: free-drag nodes + zoom/pan (2026-08-07)

The tree/flowchart canvas (`SessionTree.tsx`) now supports repositioning —
both whole session-root trees and individual subagent nodes can be dragged
anywhere, plus scroll-to-zoom, +/− buttons, and a "Fit" button that frames
every node currently in the pane.

- Reused the layout backend built for the old drag/nest fleet board
  (`/api/layout`, `SqliteLayoutStore`, `useLayout.ts`) rather than adding a
  new persistence path — it's a generic `tileId -> {x,y}` store, so subagent
  `agentId`s work as keys exactly like session ids did before. Un-dragged
  nodes fall back to a computed default (session roots in a left-to-right
  row; subagent children centered in a row under their *live* parent
  position, so an undragged child visually follows its root while the root
  itself is being dragged).
- Real bug caught before this ever reached the browser: the first draft
  tracked "has this gesture crossed the drag threshold" as its own React
  state (`setDidDrag`), called from *inside* the `setDrag` updater function.
  That's an impure updater with a side effect — exactly what React
  StrictMode's double-invoke exists to catch, since it can call an updater
  more than once per event. Fixed by tracking that flag in a ref instead —
  it doesn't need its own render pass, only `drag.dx/dy` does, and mutating
  a ref is harmless if invoked twice.
- Zoom is a CSS `transform: scale()` on the canvas with `transform-origin: 0
  0`; the scroll container is a separate non-transformed wrapper positioned
  `absolute; inset: 0` so the floating zoom-control pill can be pinned to
  the pane's corner via plain `position: absolute` without being pushed
  around by the (very large, 1600px+) scrollable canvas content — a sibling
  `position: sticky` inside the scrolling element does not stay put here,
  it still scrolls away once the content is taller than the pill's sticky
  offset allows. Drag math divides screen-space pointer deltas by the
  current zoom so a node tracks the cursor 1:1 at any zoom level; the
  drag-vs-click distance threshold is checked in *screen* space (what the
  user actually felt) before converting.
- "Fit" reads real DOM boxes (`offsetLeft/Top/Width/Height` on every
  `.tree-node`) rather than recomputing positions from state, so it works
  regardless of how much has been dragged around — those offsets are
  unaffected by the ancestor's scale transform.
- Verified live: dragged a session-root tree to a new spot with the
  subagents underneath it, reloaded the page, confirmed the position
  persisted via `/api/layout`; zoom in/out and Fit all confirmed visually
  in a real browser tab.

## Header: live machine-wide token count + clock + agent status counts (2026-08-06/07)

Added to the top nav bar (`App.tsx`), independent of the sidebar/tree
rebuild above:

- `src/server/transcripts/machine-usage.ts` — `MachineUsageTracker` walks
  every `.jsonl` under `~/.claude/projects/` (main + subagent transcripts),
  sums token usage with the same per-file `message.id` dedup as a single
  session (`usage.ts`), and caches completed files by size so a 2s rescan
  interval doesn't re-parse full history each tick. Emits `"update"`,
  fanned out over the existing `/ws` hub as `{type: "usage"}` (`ws.ts`) —
  same push pattern as session discovery, not a client poll. `GET
  /api/usage` covers first paint.
- Web: `useUsage.ts` (WS + REST first-paint, mirrors `useSessions.ts`),
  `useAnimatedNumber.ts` (count-up tween), `components/HeaderStats.tsx`
  (`HeaderClock` — live seconds/timezone/date, ticks every 1s client-side;
  `TokenUsageBadge` — animated total with a brief pulse on increase, hover
  tooltip breaks down input/output/cache).
- `AgentStatusSummary` (same `HeaderStats.tsx`) — counts every discovered
  session by status (`busy`→"running", `waiting`, `idle`, `shell`,
  `unknown`) with `alive: false` sessions bucketed as "offline" first
  regardless of their last-known status, so no session double-counts.
  Reuses `useSessions()` directly (already real-time over /ws) — no new
  server endpoint needed, this one's purely a client-side aggregation of
  data already being pushed for the sidebar.
- Verified live in a real browser: token count and clock both advanced
  correctly across a 3s wait with no page reload; status counts
  (`8 running · 1 idle · 8 offline`) matched the sidebar's per-row
  status/offline badges exactly.
- Tests: `machine-usage.test.ts` (5 cases, temp-dir fixtures, no real
  `~/.claude` data touched per the fixture rule below).

## Possible follow-ups (beyond the original 10 tasks — not a "we're basically done" list)

- Fleet board free-positioned tiles can visually overlap when a parent tile
  grows taller after gaining nested children — cosmetic, drag it away.
- No tests yet for the new `web/` components (TicketBoard, PathPicker,
  adopt flow) beyond manual browser verification — the server side has 86
  passing tests, the web side has none. Worth adding if this grows further.

Done since the list above was written: the fleet board is now real-time
over `/ws` instead of polling (`useSessions.ts` connects directly, matching
SessionDetail's reconnect-with-backoff pattern) — verified by launching a
real `claude --bg` session and watching it appear with zero extra
`/api/sessions` requests.

## Chat UX pass, directly from user feedback (2026-08-07)

User feedback: the transcript view was showing system/attachment/other
noise (`turn_duration`, `stop_hook_summary`, raw tool_result "user" lines),
empty assistant bubbles, and didn't read like a chat. Landed in response:

- `SessionDetail`/`SubagentDetail` now only render real user turns,
  assistant text, and assistant tool actions — everything else filtered
  client-side, entries with no preview text dropped instead of rendering
  empty. Restyled to read like Claude Code's own output (plain prose, `›`
  for user turns, `●` bullet for tool actions) instead of a log table.
- Consecutive identical tool calls collapse into one line ("Bash ×5"),
  click to expand and see each call's actual command/file_path/etc. —
  server-side `parse.ts` now extracts `toolName`/`toolDetail` per entry to
  make that possible. Shared via `groupChatEntries()`/`ToolGroup`, exported
  from `SessionDetail.tsx` and reused as-is in `SubagentDetail.tsx`.
- Shift-click multi-select in the sidebar + bulk "Adopt all" (with the same
  `ConfirmModal` pattern as single adopt), verified against two real
  disposable `claude --bg` sessions end to end through the actual UI.
- Sidebar and detail panels are now drag-to-resize (`useResizableWidth` +
  `Resizer`), width persisted per-panel in localStorage, clamped to a
  sane min/max, correct direction on both a left- and a right-anchored
  panel.

Tooling note that mattered for verifying all of this: the `computer` tool's
`left_click_drag` does not reliably fire dnd-kit's `PointerSensor` or plain
`pointerdown`/`pointermove`/`pointerup` listeners — dispatch real
`PointerEvent`s via `mcp__claude-in-chrome__javascript_tool` instead for
any drag interaction (tile drag, panel resize). Confirmed working that way
in every case above.

## Notes on how this repo is being built

- Multiple sessions share this literal working directory — not git
  worktrees. Expect to see files change under you mid-session; that's
  normal, not corruption. Only stage/commit files you actually own for the
  task at hand (`git add <specific paths>`, never `git add -A`).
- Everything claimed "done" above was verified against real behavior, not
  just `tsc --noEmit`. Keep that bar — it's caught real bugs every time
  it's been applied (see above).
- No Claude co-author trailer in commits; author stays the human user.
