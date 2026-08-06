<div align="center">

# 🛰️ Beacon

**Local mission control for your Claude Code agents.**

One dashboard for every Claude Code session running on your machine — across every
project, every directory — with real control over the agents Beacon launches, and a
ticket system your agents can write to themselves.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-early%20development-orange)](#status)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

</div>

---

## What is this?

Claude Code sessions pile up fast — one per terminal tab, one per project, background
agents nobody remembers starting. There's no single place to see them all, no way to
peek at what a background agent is doing without hunting down its transcript, and no
shared backlog when several agents are working on related things across different repos.

**Beacon** is a local web dashboard that fixes that:

- 🔍 **Discovers every session** on the machine, in any directory, by watching Claude
  Code's own on-disk state — no config, no per-project setup.
- 🎮 **Full control over agents Beacon launches** — stream output live, send follow-up
  prompts, interrupt, approve permission requests, kill — straight from the browser.
- 👁️ **Read-only visibility into everything else** — transcript, live status, token
  usage, subagent tree, for sessions started the normal way (terminal, `claude`, etc.),
  plus the ability to kill or **adopt** them into full control.
- 🎫 **A cross-project ticket system** — a JIRA-lite backlog, backed by SQLite, that
  agents read and write themselves via MCP. Point five agents in five different repos at
  the same board.

Everything runs locally. Nothing leaves your machine unless you explicitly bind it
somewhere else (see [Security](#security)).

## Why it exists (and what it deliberately isn't)

Claude Code already ships `claude agents` — a built-in TUI with dispatch/peek/reply/stop
across directories, backed by a supervisor daemon. **Beacon does not try to rebuild
that.** Session listing and control are table stakes here, kept intentionally thin.

Beacon's actual reason to exist is:

1. A real browser UI — history, search, multiple sessions on screen at once — instead of
   a single-pane terminal TUI.
2. A **cross-project ticket system** agents can file, claim, and update through MCP,
   so coordination doesn't depend on someone eyeballing four terminal windows.

Beacon also deliberately **never speaks Claude Code's private daemon control-socket
protocol** (undocumented, holds live PTY-equivalent secrets, can change on any update).
Where it needs to take over a session someone else started, it does so through the
public Agent SDK via *adopt-via-resume* — stop the external process, resume the same
session under an SDK-owned one. That's a deliberate, visible action (it interrupts
in-flight work), not a silent hijack.

## Status

🚧 **Early development — architecture is settled, most of it isn't built yet.**

| Piece | State |
| --- | --- |
| HTTP server, loopback-only bind, bearer-token gate for non-loopback | ✅ working |
| Static hosting of the web SPA | ✅ working |
| Web SPA scaffold (Vite + React) | ✅ working |
| Session discovery (`fs.watch` over `~/.claude/{sessions,jobs,daemon}`) | ⏳ planned |
| Owned-agent supervisor (Agent SDK push-queue sessions) | ⏳ planned |
| Transcript reader (history + live tail) | ⏳ planned |
| Ticket system (SQLite-backed, MCP-exposed) | ⏳ planned |
| MCP endpoints (Streamable-HTTP + in-process) | ⏳ planned |
| Dashboard UI (fleet view, ticket board, agent control) | ⏳ planned |

If you're looking at this repo hoping to *use* a finished dashboard today: not yet. If
you want to help build one, the design is unusually well-specified — see
[Architecture](#architecture) and [Contributing](#contributing).

## Architecture

```
beacon-hq  (single npm package, TypeScript, pnpm workspace)
│
├── bin/            npx beacon-hq — starts the server, opens the browser
│
├── src/
│   ├── cli.ts              entrypoint: parses --port/--host, starts the server
│   └── server/
│       ├── index.ts        ✅ Fastify app, static hosting, /api/health
│       ├── auth.ts         ✅ loopback bypass + bearer-token gate for --host
│       ├── discovery/      ⏳ watches ~/.claude/{sessions,jobs,daemon}
│       │                      + periodic `claude agents --json --all` reconcile
│       ├── transcripts/    ⏳ session history + live tail of transcript files
│       ├── supervisor/     ⏳ Beacon-owned agents via the Agent SDK
│       ├── tickets/        ⏳ SQLite-backed JIRA-lite service ("tickets-core")
│       └── mcp/            ⏳ Streamable-HTTP MCP endpoint (external sessions)
│                              + in-process createSdkMcpServer() (owned sessions)
│
├── web/            ✅ scaffold — React 19 + Vite SPA (dashboard UI: ⏳)
│
└── db/             ⏳ SQLite schema + migrations, lives at ~/.beacon/beacon.db
```

`tickets-core` is designed as a pure module (`createTicket`, `updateTicket`,
`listTickets`) consumed by *both* MCP surfaces, so a session Beacon owns and a session
someone started in a terminal write through identical logic — one ticket system, no
special cases.

### Two classes of agent

| | Discovered (external) | Owned |
| --- | --- | --- |
| Started by | anything run in a terminal | Beacon, via the Agent SDK |
| Live state, transcript, tokens, cwd | ✅ | ✅ |
| Kill | ✅ (verified-pid `SIGTERM`) | ✅ |
| Stream output, push prompts, interrupt, approve permissions | ❌ | ✅ |
| Adopt → owned | via *adopt-via-resume* | — already owned |

*Adopt-via-resume* is the bridge: stop the external session, resume the same
`sessionId` (with its recorded `cwd`) under an SDK-owned push-queue process. Public SDK
surface only, every time.

## Quickstart

Requires **Node ≥ 22.5.0** and **pnpm**.

```bash
git clone <this-repo-url>
cd Beacon
pnpm install

# terminal 1 — API server, restarts on change
pnpm dev:server

# terminal 2 — web SPA with hot reload, proxied to the server
pnpm dev:web
```

Open the URL Vite prints (typically `http://localhost:5173`). The server itself listens
on `http://127.0.0.1:4317` by default.

Building a production bundle (SPA compiled into `public/`, server bundled into `dist/`,
run via `bin/beacon-hq.js`):

```bash
pnpm build
pnpm start
```

Once published, the intended distribution is `npx beacon-hq` — not live yet.

## Security

This is a local tool that gets to see and touch other Claude Code sessions on your
machine, including their transcripts. That's treated as a hard constraint, not an
afterthought:

- **Binds to `127.0.0.1` by default.** Passing `--host` to bind elsewhere requires a
  bearer token, generated fresh and printed once at startup — never persisted to disk.
- **Transcripts are the biggest exposure.** They can contain raw shell commands, command
  output, and full file contents — including the contents of `.env` files. The plan is
  to cache only envelope + tool name + token counts by default; full message content
  stays opt-in.
- **Never read, cache, or log:** `~/.claude/daemon/control.key`, `roster.json`'s
  `rvAuth`/`ptyAuth`, `~/.claude.json`'s `oauthAccount`/`userID`/`machineID`/
  `mcpServers[*].env`, `~/.claude/backups/*`, `~/.claude/shell-snapshots/*`.
- **Kill is treated as remote code execution if it's ever exposed without the
  loopback/token gate.** Every kill verifies the target's `procStart` against the live
  process first, to avoid signalling a reused PID.
- **Spawns use argv arrays only** — never shell string interpolation — and every cwd
  submitted from the UI gets path-validated before use.
- No external CDN dependencies; the UI is built to work fully offline; CSP is on the
  roadmap alongside the dashboard itself.

Found a gap between this section and reality? Please open an issue rather than a PR with
the fix — see [Contributing](#contributing).

## Contributing

This project is young enough that the architecture doc *is* the contribution guide.
Useful things to know before sending a PR:

- **Read `CLAUDE.md`** in the repo root first — it has the verified on-disk layout of
  Claude Code's session/job state, the traps in it (mangled directory names, double-
  counted token usage, racy `~/.claude.json`), and the Agent SDK gotchas that inform
  every design decision here.
- Session state should be read via `fs.watch`, cross-checked periodically against
  `claude agents --json --all` — never polled as the fast path.
- Never copy real transcript content into the repo, fixtures, or logs. Test fixtures are
  hand-authored synthetic transcripts only.
- Security items above are non-negotiable, not stylistic preferences — a PR that
  weakens the loopback default or logs transcript content wholesale won't be merged as-is.

Issues and PRs welcome — small, focused ones especially, given how much of the
`⏳ planned` list above is still open.

## License

[MIT](./LICENSE) © Beacon contributors
