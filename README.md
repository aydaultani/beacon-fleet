# Beacon

**Local mission control for your Claude Code agents.**

One dashboard for every Claude Code session running on your machine, across every
project and directory, with real control over the agents Beacon launches and a ticket
system your agents can write to themselves.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-in%20testing%2C%20not%20released-yellow)](#status)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

## What is this?

Claude Code sessions pile up fast: one per terminal tab, one per project, background
agents nobody remembers starting. There's no single place to see them all, no way to
peek at what a background agent is doing without hunting down its transcript, and no
shared backlog when several agents are working on related things across different repos.

Beacon is a local web dashboard that fixes that:

- Discovers every session on the machine, in any directory, by watching Claude Code's
  own on-disk state. No config, no per-project setup. Updates live over a WebSocket, not
  a poll.
- Full control over agents Beacon launches: stream output live, send follow-up prompts,
  interrupt, approve permission requests, kill, all from the browser.
- Read-only visibility into everything else (transcript, live status, token usage) for
  sessions started the normal way (terminal, `claude`, etc.), plus a one-click **Adopt**
  that hands you full control of one.
- A fleet board of draggable tiles, one per session — drag one onto another to group it
  underneath, purely as your own spatial organization (it never touches Claude Code's
  real process hierarchy).
- A cross-project ticket board: a JIRA-lite backlog, backed by SQLite, that agents read
  and write themselves via MCP. Point five agents in five different repos at the same
  board.

Everything runs locally. Nothing leaves your machine unless you explicitly bind it
somewhere else (see [Security](#security)).

## Ask an LLM about this repo

If you'd rather have an LLM walk you through the project than read the rest of this
file, clone the repo, point a coding assistant (Claude Code, Cursor, etc.) at it, and
try one of these:

- "Read README.md and CLAUDE.md in this repo and explain what Beacon does, in plain
  terms, to someone who has never used Claude Code."
- "What's the difference between a 'discovered' and an 'owned' agent in Beacon, and why
  does that distinction exist?"
- "Walk me through Beacon's architecture: what's built, what's planned, and how the
  pieces in src/server are supposed to fit together."
- "Why does Beacon refuse to speak Claude Code's private daemon control-socket protocol,
  and what does it do instead?"
- "I want to add a feature to Beacon. Based on CLAUDE.md, what traps should I watch out
  for around session discovery, transcripts, or token usage?"
- "Summarize Beacon's security posture: what does it bind to by default, what does it
  refuse to log, and what's still on the roadmap?"

These work well because `CLAUDE.md` carries the verified, low-level detail (on-disk
layout, Agent SDK gotchas, traps) that this README intentionally keeps out.

## Why it exists (and what it deliberately isn't)

Claude Code already ships `claude agents`, a built-in TUI with dispatch/peek/reply/stop
across directories, backed by a supervisor daemon. Beacon does not try to rebuild that.
Session listing and control are table stakes here, kept intentionally thin.

Beacon's actual reason to exist is:

1. A real browser UI: history, search, multiple sessions on screen at once, instead of a
   single-pane terminal TUI.
2. A cross-project ticket system agents can file, claim, and update through MCP, so
   coordination doesn't depend on someone eyeballing four terminal windows.

Beacon also deliberately never speaks Claude Code's private daemon control-socket
protocol (undocumented, holds live PTY-equivalent secrets, can change on any update).
Where it needs to take over a session someone else started, it does so through the
public Agent SDK via adopt-via-resume: stop the external process, resume the same
session under an SDK-owned one. That's a deliberate, visible action (it interrupts
in-flight work), not a silent hijack.

## Status

**Not released. Actively in testing, with real bugs still being found and fixed as it
gets exercised end to end.** Every piece below has been implemented and has worked in at
least one real, hands-on test pass (real launched agents, a real external MCP client,
real SQLite writes, a real browser session) — that's a higher bar than "typechecks," but
it is not the same thing as "stable" or "release-ready." Treat anything in this repo as
a working prototype you're trying, not a finished product. It has not been cut as a
release and isn't published to npm; that only happens with explicit sign-off, not
automatically as pieces land.

| Piece | State |
| --- | --- |
| HTTP server, loopback-only bind, bearer-token gate for non-loopback | implemented |
| Session discovery (`fs.watch` + periodic `claude agents --json --all` reconcile) | implemented |
| Transcript reader (history + incremental live tail) | implemented |
| Owned-agent supervisor (Agent SDK push-queue sessions) | implemented |
| Adopt-via-resume (take control of an external session) | implemented |
| Ticket system (SQLite via `node:sqlite`, MCP-exposed) | implemented |
| MCP endpoints (standalone HTTP `/mcp` + in-process, both surfaces) | implemented |
| Fleet board (draggable/nestable session tiles, real-time over WebSocket) | implemented |
| Session detail (live transcript, prompt/interrupt/kill, permission cards, adopt) | implemented |
| Ticket board (kanban view over the ticket system) | implemented |
| CSP headers | not started |

"Implemented" means built and exercised at least once, not bug-free — see `PROGRESS.md`
in the repo root for the live, unvarnished status: what's actually been tested, what
broke and got fixed, and what's still suspect. Trust that file over this README, and
trust neither over actually running it yourself.

## Architecture

```
beacon-fleet  (single npm package, TypeScript, pnpm workspace)
│
├── bin/            npx beacon-fleet, starts the server and opens the browser
│
├── src/
│   ├── cli.ts              entrypoint: parses --port/--host, starts the server,
│   │                         opens the browser, handles graceful shutdown
│   └── server/
│       ├── index.ts        Fastify app: wires every piece below together
│       ├── auth.ts         loopback bypass + bearer-token gate for --host
│       ├── discovery/      watches ~/.claude/{sessions,jobs,daemon}, cross-checks
│       │                     against `claude agents --json --all` every ~10s
│       ├── transcripts/    session history + incremental live tail of transcript files
│       ├── supervisor/     Beacon-owned agents via the Agent SDK (streaming input,
│       │                     interrupt, permission approval, adopt-via-resume)
│       ├── mcp/            standalone HTTP MCP endpoint (external sessions)
│       │                     + in-process createSdkMcpServer() (owned sessions)
│       ├── routes/         REST: agents, tickets, layout, directory browsing
│       └── ws.ts           single WebSocket hub: live session list + agent events
│
├── db/             SQLite schema + migrations + tickets-core, lives at
│                     ~/.beacon/beacon.db (node:sqlite — no native build step)
│
└── web/            React 19 + Vite SPA — fleet board, session detail, ticket board
```

`tickets-core` (`db/tickets-core.ts`) is a pure module (`createTicket`, `updateTicket`,
`listTickets`) consumed by both MCP surfaces, so a session Beacon owns and a session
someone started in a terminal write through identical logic. One ticket system, no
special cases.

### Two classes of agent

| | Discovered (external) | Owned |
| --- | --- | --- |
| Started by | anything run in a terminal | Beacon, via the Agent SDK |
| Live state, transcript, tokens, cwd | yes | yes |
| Kill | yes (verified-pid `SIGTERM`) | yes |
| Stream output, push prompts, interrupt, approve permissions | no | yes |
| Adopt to owned | via adopt-via-resume | already owned |

Adopt-via-resume is the bridge: stop the external session, resume the same `sessionId`
(with its recorded `cwd`) under an SDK-owned push-queue process. Public SDK surface only,
every time.

## Quickstart

Requires Node >= 22.5.0 and pnpm.

```bash
git clone <this-repo-url>
cd Beacon
pnpm install

# terminal 1: API server, restarts on change
pnpm dev:server

# terminal 2: web SPA with hot reload, proxied to the server
pnpm dev:web
```

Open the URL Vite prints (typically `http://localhost:5173`). The server itself listens
on `http://127.0.0.1:4317` by default.

Building a production bundle (SPA compiled into `public/`, server bundled into `dist/`,
run via `bin/beacon-fleet.js`) and running it as a single process:

```bash
pnpm build
pnpm start
```

Run the test suite (`node --test` via `tsx`, no separate test runner dependency):

```bash
pnpm test
```

Once published, the intended distribution is `npx beacon-fleet` (not live yet). The
package name `beacon-fleet` is already reserved on npm.

## Security

This is a local tool that gets to see and touch other Claude Code sessions on your
machine, including their transcripts. That's treated as a hard constraint, not an
afterthought:

- Binds to `127.0.0.1` by default. Passing `--host` to bind elsewhere requires a bearer
  token, generated fresh and printed once at startup, never persisted to disk. Verified:
  no token means every route 401s, including the ones that don't look sensitive.
- Transcripts are the biggest exposure. They can contain raw shell commands, command
  output, and full file contents, including the contents of `.env` files. Beacon's own
  database (`~/.beacon/beacon.db`) never stores any of it — tickets and fleet-board layout
  are the only things persisted there. Transcript content is read on demand from Claude
  Code's own files and streamed straight to the browser, never cached in between.
- Never read, cache, or log: `~/.claude/daemon/control.key`, `roster.json`'s
  `rvAuth`/`ptyAuth`, `~/.claude.json`'s `oauthAccount`/`userID`/`machineID`/
  `mcpServers[*].env`, `~/.claude/backups/*`, `~/.claude/shell-snapshots/*`.
- Kill is treated as remote code execution if it's ever exposed without the
  loopback/token gate. Every kill verifies the target's `procStart` against the live
  process first, to avoid signalling a reused PID.
- Spawns use argv arrays only, never shell string interpolation, and every cwd submitted
  from the UI gets path-validated before use.
- No external CDN dependencies, no external fonts. The UI is built to work fully
  offline. CSP headers are the one item still on the roadmap, not yet implemented.

Found a gap between this section and reality? Please open an issue rather than a PR with
the fix. See [Contributing](#contributing).

## Contributing

Useful things to know before sending a PR:

- Read `CLAUDE.md` in the repo root first. It has the verified on-disk layout of Claude
  Code's session/job state, the traps in it (mangled directory names, double-counted
  token usage, racy `~/.claude.json`), the Agent SDK gotchas, and a running list of real
  bugs already found and fixed (worth checking before you reintroduce one).
- `PROGRESS.md` is the live status board — what's done, what's mid-flight, what's
  actually left. Trust it over this README for anything time-sensitive.
- Session state should be read via `fs.watch`, cross-checked periodically against `claude
  agents --json --all`. Never polled as the fast path.
- Never copy real transcript content into the repo, fixtures, or logs. Test fixtures are
  hand-authored synthetic transcripts only.
- Security items above are non-negotiable, not stylistic preferences. A PR that weakens
  the loopback default or logs transcript content wholesale won't be merged as-is.
- Run `pnpm typecheck` and `pnpm test` before opening a PR; both run clean on `main`.

The server side has automated test coverage (86 tests, `node --test`); the web UI has
none yet, only manual browser passes — that's a real gap, not a formality, and a good
place to start if you want to help find what's still broken.

Issues and PRs welcome, small and focused ones especially.

## License

[MIT](./LICENSE) (c) Beacon contributors
