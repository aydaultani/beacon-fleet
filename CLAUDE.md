# Beacon

Local mission control for Claude Code agents: a browser dashboard that discovers every
Claude Code session on the machine (any directory), gives full control (prompt,
interrupt, kill) over agents Beacon itself launches, and runs a cross-project JIRA-lite
ticket system that agents write to via MCP.

Package name: `beacon-fleet`. Run via `npx beacon-fleet`.

> **Name history (2026-08-06):** `beacon` and `claude-beacon` were already taken on
> npm. We then reserved `beacon-hq` and started building against that name — it's
> published in the ticket/architecture prose below and in old commits — but npm's
> registry **blocked publishing `beacon-hq`** as too similar to an unrelated existing
> package, `beaconhq`. Renamed to `beacon-fleet` everywhere (package name, bin,
> `@beacon-hq/web` → `@beacon-fleet/web`) and reserved it on npm as a placeholder
> (`0.0.1`, no real code). **If you're touching this repo and see a stray `beacon-hq`
> reference below or in code/config, it's stale — the live name is `beacon-fleet`.**
> The GitHub repo has since also been renamed to `aydaultani/beacon-fleet` to match.

Design plan and rationale: `~/.claude/plans/purrfect-noodling-whisper.md`.

## Why this exists / non-goals

Claude Code already ships `claude agents` — a TUI with dispatch/peek/reply/stop across
directories, backed by a supervisor daemon. **Do not try to rebuild that.** Beacon's
reason to exist is the cross-project ticket system and a real browser UI with history
and search. Session management is table stakes, kept intentionally thin.

## Architecture

```
beacon-fleet (single npm package, TypeScript)
├── cli/            npx beacon-fleet — starts server, opens browser
├── server/
│   ├── discovery/  fs.watch over ~/.claude/{sessions,jobs,daemon}
│   │               + `claude agents --json --all` reconcile every ~10s
│   ├── transcripts/ SDK getSessionMessages() for history, byte-offset tail for live
│   ├── supervisor/ Beacon-owned agents via Agent SDK push-queue sessions
│   ├── tickets/    SQLite-backed JIRA-lite service (tickets-core)
│   └── mcp/        Streamable-HTTP MCP endpoint (external sessions)
│                   + createSdkMcpServer() in-process (owned sessions)
├── web/            React + Vite SPA
└── db/             SQLite schema + migrations (~/.beacon/beacon.db)
```

`tickets-core` is a pure module (`createTicket`, `updateTicket`, `listTickets`) consumed
by both MCP surfaces so owned and external sessions write through identical logic.

### Two classes of agent

- **Discovered (external)** — anything started in a terminal. Read-only: live state,
  transcript, tokens, cwd, subagent tree, plus **kill** (verified-pid SIGTERM) and
  **adopt**.
- **Owned** — launched by Beacon via the Agent SDK. Full duplex: stream output, push
  follow-up prompts, interrupt, approve permission prompts from the browser, kill.
- **Adopt-via-resume** bridges them: stop the external session, resume the same
  `sessionId` (with its recorded `cwd`) under an SDK-owned push-queue process. Public
  API only — Beacon never speaks the private daemon control-socket protocol (see below).
  Destructive-ish: requires explicit UI confirmation, interrupts in-flight work.

## Claude Code on-disk state (verified on this machine, v2.1.223)

All plain files, watchable with `fs.watch` — no subprocess polling needed on the fast
path. `claude agents --json --all` (~285ms/call, spawns node) is the authoritative
cross-check; poll it periodically (~10s), never as the fast path.

| Path | Contents |
| --- | --- |
| `~/.claude/sessions/<pid>.json` | **Primary liveness registry.** `pid`, `sessionId`, `cwd`, `kind` (`interactive`\|`bg`), `name`, `status` (`busy`\|`waiting`\|`idle`\|`shell`), `waitingFor`, `procStart`, `version`, `jobId`, `parkedJobId` |
| `~/.claude/daemon/roster.json` | bg worker registry keyed by 8-char short id. **Contains `rvAuth`/`ptyAuth` secrets — never log or store.** |
| `~/.claude/jobs/<short8>/state.json` | Richest bg state: `state`, `detail`, `needs`, `tokens`, `inFlight`, `fan`, `cwd`, `sessionId`, `linkScanPath`, `linkScanOffset` |
| `~/.claude/jobs/<short8>/timeline.jsonl` | `{at, state, detail, text}` per transition |
| `~/.claude/projects/<mangled>/<sessionId>.jsonl` | Full transcript |
| `~/.claude/projects/<mangled>/<sessionId>/subagents/agent-<id>.jsonl` | Subagent transcripts (`isSidechain: true`) |
| `~/.claude.json` → `projects` | **Authoritative map of real absolute project paths** |
| `~/.claude/daemon.status.json`, `daemon.lock` | Supervisor pid + liveness |

### Traps (each of these will produce silently wrong results)

- **Project dir names are lossy.** Mangling replaces `/`, `.`, `_`, and space all with
  `-`. `-Users-apple-Desktop-STUFF-ad-com` could be `STUFF/ad.com`, `STUFF/ad/com`, or
  `STUFF-ad.com`. **Never reverse it.** Get real paths from `~/.claude.json`'s `projects`
  keys or the `cwd` field inside a transcript line. Mangling forward (path → dir name) is
  fine and used for locating a project's transcript dir.
- **`cwd` is per-line and can change mid-session** (user `cd`s, or `--add-dir`). The
  directory name reflects only the cwd at session start.
- **Token usage double-counts.** One API response is split across multiple `assistant`
  lines, each repeating the *same* `message.usage` and `message.id`. **Dedup by
  `message.id`** before summing or totals inflate ~2x.
- **`sessions/<pid>.json` is stale-on-crash.** Always verify with `process.kill(pid, 0)`
  and compare `procStart` against the live process to guard PID reuse. Don't trust file
  mtime for liveness — only for last-activity.
- **`~/.claude.json` is racy** — 58KB of live mutable state the CLI rewrites constantly.
  Never read-modify-write it directly. Shell out to `claude mcp add` / `claude mcp list
  --json` instead.
- No explicit session-end line exists in this version; turn boundaries are
  `system/turn_duration` lines. No `todos/` dir either — todos live inline in the
  transcript (`toolUseResult.newTodos` / `todo_reminder` attachments).
- Rate-limited sessions: `isApiErrorMessage: true` + `apiErrorStatus: 429`.

## Agent SDK (`@anthropic-ai/claude-agent-sdk` v0.3.223)

Zero runtime deps, but **peer deps must be installed explicitly**:
`@anthropic-ai/sdk >=0.93`, `@modelcontextprotocol/sdk ^1.29`, `zod ^4`.

- Pin `pathToClaudeCodeExecutable` to the user's own `claude` binary — otherwise the SDK
  runs whichever CLI version it bundled, which can lag behind what wrote existing
  transcripts.
- **`options.env` REPLACES the subprocess env entirely.** Always spread `process.env`
  first or the CLI loses `PATH`/`HOME` and can't find credentials.
- Read `apiKeySource` off the `system`/`init` message (`'oauth'` = subscription login)
  and surface it in the UI — this is the runtime proof of which credential is live.
  `ANTHROPIC_API_KEY` is a first-class supported alternate path (required reading:
  Anthropic's policy against third parties offering claude.ai login for their own
  products — fine for personal use against your own login, a real constraint once
  distributed; document this in the README).
- **Streaming input is mandatory for control.** `interrupt()`, `setPermissionMode()`,
  `setModel()` only work when `prompt` is an `AsyncIterable<SDKUserMessage>`. The
  generator must **never return** while the session should stay alive — use a push queue
  that blocks indefinitely (see the pattern in the plan file).
- Prefer the public session APIs over hand-parsing transcripts: `listSessions()`,
  `getSessionInfo()`, `getSessionMessages()`, `getSubagentMessages()`, `forkSession()`,
  `renameSession()`, `deleteSession()`. They read the same files and don't distinguish
  CLI- from SDK-created sessions, so they also see terminal-started sessions.
- **Resume requires the matching `cwd`.** Always persist `(sessionId, cwd)` as a pair —
  a mismatched cwd silently returns a fresh session instead of history.
- Termination ladder: `interrupt()` = stop current turn, keep session; `queue.close()` =
  graceful end after current turn; `q.close()` = hard kill (subprocess + MCP transports).
- Cost/usage: **read the latest `SDKResultMessage.modelUsage`, never sum across
  results** — it's cumulative per session. `usage` on other messages is main-loop-only
  (excludes subagents).
- `SDKSessionStateChangedMessage.state` (`idle`/`running`/`requires_action`) is the
  authoritative busy/idle signal — drive the UI spinner off this, not heuristics.
- `canUseTool` may stay pending indefinitely; that's the intended browser-approval
  bridge. **Trap:** tools auto-approved by `allowedTools`/`permissionMode` never reach
  it — listen for the `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` process warning.
  `AskUserQuestion` also arrives through `canUseTool`; render it as a multiple-choice
  card, not a generic allow/deny dialog.
- **In-process MCP servers (`createSdkMcpServer`) cannot be reached by external `claude`
  sessions** — the config is a live JS object handle in Beacon's process, not a socket.
  External sessions need the standalone Streamable-HTTP MCP endpoint instead.

## Security posture (open source — non-negotiable)

- Bind `127.0.0.1` by default. `--host` requires a generated bearer token, printed once
  at startup.
- `.gitignore` covers: `~/.beacon`, `*.db`, `*.jsonl`, `.env`, `*.log`, `.claude*`.
- **Never** copy real transcript content into the repo, fixtures, or logs. Test fixtures
  are hand-authored synthetic transcripts only.
- Never read, cache, or log: `~/.claude/daemon/control.key`, `roster.json`'s
  `rvAuth`/`ptyAuth`, `~/.claude.json`'s `oauthAccount`/`userID`/`machineID`/
  `mcpServers[*].env`, `~/.claude/backups/*`, `~/.claude/shell-snapshots/*`.
- Transcripts are the largest exposure — they embed raw shell commands, command stdout,
  and full file contents including `.env` files. Cache only envelope + tool name + token
  counts by default; full message content is opt-in only.
- Redact common secret shapes on ingest before persisting anything derived.
- Path-validate every cwd submitted from the UI; spawn with **argv arrays only**, never
  shell string interpolation.
- The kill endpoint is remote code execution if exposed without the loopback/token gate
  — always verify `procStart` against the live process before signalling.
- CSP, no external CDN, UI works fully offline.

## Why not the private daemon control socket

The built-in `claude agents` TUI attaches to background sessions via
`/tmp/cc-daemon-501/<inst>/control.sock`, authenticated by `~/.claude/daemon/control.key`
and per-worker `rvAuth`/`ptyAuth` tokens in `roster.json`. This is undocumented private
API — holding those tokens is equivalent to driving a live agent's PTY, and the protocol
can change on any Claude Code update. Beacon deliberately never speaks it; adopt-via-resume
(above) is the supported substitute for gaining control of an external session.
