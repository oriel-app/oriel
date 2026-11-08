# 0062 The backend's shape: plain TypeScript, one process supervisor, smaller composition roots, and Effect not now

Proposed 2026-11-08, from an architecture pass and a spike on branch [`effect-spike`](https://github.com/oriel-app/oriel/tree/effect-spike), which isn't merged. Keeps SPEC §6 and 0008 as they are.

Adds: none

The maintainer, 2026-11-08: "the app is getting complex. I think we need to do a architecture pass. and should once again consider effect … the backend is getting a little unwieldy and i like that tanstack is moving towards more integration with it."

## Decision

1. **Effect isn't adopted now, wholesale or at the edges.** The backend stays plain TypeScript. What makes it unwieldy is fixed by the stories below, and none of them needs Effect.
2. **One process supervisor** in packages/agent owns every long-lived child process: the CLI turns, Codex's app server, 0060's tool host and the first run's commands. It is the spike's plain tool host, generalised.
3. **The composition roots get smaller.** `createApp`, `changeSetsOver` and `api` split into modules with explicit inputs, until no backend function is over 400 lines.
4. **One owner for each repeated thing:**
   - one harness interface;
   - one stdio MCP server;
   - the "waits on you" rule in core;
   - a known server's identity in its connector's declaration only.
5. **Revisit Effect** when either of these happens, and run the spike's comparison again on the code as it is then:
   - two or more fixes merged in a month for cancellation, cleanup or leaked processes, outside the supervisor;
   - Oriel runs as a hosted, multi-tenant server.

   If it's adopted then, use the shape the spike measured:
   - only in packages/agent and packages/server;
   - behind Promise edges;
   - with deep imports;
   - never in core, sandbox, bindings, changeset or web.

## What the pass found (main at f721b8a3)

**Size.**

- The backend's packages hold 63,787 lines of source, tests excluded: 48,752 on 2026-11-05, so 31% more in three days, mostly 0059.
- `server/src/app.ts` went from 1,981 lines to 2,954 in the same three days.

**Files over 800 lines:**

| File                     | Lines |
| ------------------------ | ----: |
| server/app.ts            | 2,954 |
| changeset/change-sets.ts | 2,150 |
| server/api.ts            | 1,694 |
| server/actions.ts        | 1,315 |
| agent/claude-code.ts     | 1,191 |
| agent/codex.ts           | 1,151 |
| server/views.ts          |   915 |
| db/threads.ts            |   807 |

**Functions that are whole modules.** Each is one closure with its state in local variables, so no part of it can be tested or read alone.

- **`createApp`, 2,641 lines.** It holds:
  - the database;
  - connections, kinds, source servers and stand-ins (about 1,000 lines, app.ts 336–1353);
  - sync turns and timers;
  - drafts and previews;
  - the stand-in's move offer;
  - change sets;
  - the agent's wiring;
  - the overview, Noticed, Setup and the MCP door.
- **`changeSetsOver`,** 1,632 lines.
- **`api`,** 1,255 lines, with 80 routes.
- **Others over 400 lines:** `threadStore` 652, `views` 646, `indexStore` 637, `setupService` 559, `createSandbox` 478 and `turns` 465.

**Process plumbing, written several times.**

- 11 files start child processes.
- Claude Code's `startSession` (289 lines) and Codex's `startServer` each have their own line reader, map of pending requests by ID, idle timer, and SIGTERM with no SIGKILL after it.
- The first run's `setup/cli.ts` has its own group kill.
- The sandbox, `typecheck.ts` and `compiler.ts` each have their own SIGKILL.
- `server-calls.ts` passes `new AbortController().signal`, which nothing aborts.
- `ToolCaller` takes no signal, though 0060 requires one ("When a run ends, however it ends, its calls still waiting are cancelled").

**MCP servers, written four times,** each with its own two-revision handshake:

- Oriel's door, `server/mcp/protocol.ts` (434 lines);
- `standin-mcp` (127);
- `sheets-mcp` (251);
- `server/servers/tiny-server.ts` (70).

**A new harness reaches 16 files outside packages/agent.** "codex" appears in:

- 8 in server: app, api, model, main, settings, setup, setup/cli and setup/state;
- 7 in web;
- core's telemetry.

**A new kind.** 0049's "one package and one line" holds on the product path, but not for the dev stand-ins:

- `server/standins.ts` keeps a second copy of each known server's reported name.
- The Atlassian copy drifted: it says `atlassian-rovo-mcp-server`, while Jira's declaration says `atlassian-mcp-server`. So the stand-in world read the maintainer's real OA backlog through the real Atlassian server (the hub, 2026-11-08; #238).
- `changeset/writers.ts`, `standin-mcp/main.ts` and the evals' world each name the kinds again.

**Layers.** The server imports values, not only types, from the window's package `@oriel/web`:

- `waitsOnUser`;
- `chipIds`, `quoteKey` and `quotesFrom`;
- the themes.

**The 2026-11-05 audit's stories:**

| Story                                                    | Today                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OA-243: writes record only what happened                 | merged in #198, and still holds                                                                                                                                      |
| OA-244: event streams let go                             | not merged. `channel` ends on `return()`, so the site looks sound, but the report is gone and can't be checked against                                               |
| OA-245: one stalled rule                                 | not merged. `stuckDays` is one constant that core, groupings and signals share                                                                                       |
| OA-246: refused sign-in; OA-247: one source request loop | overtaken by #232: the REST clients and tokens are gone. Their job, one request path with a deadline and a stop signal, moved to 0060's tool host, which isn't built |
| OA-248: Anthropic request in one place                   | already one file, with no overload retry. Since 0059 it serves only `pnpm dev` and evals                                                                             |
| OA-249: one CLI supervisor with a hard kill              | not merged. There is no SIGKILL in packages/agent                                                                                                                    |
| OA-250: "waits on you" in core                           | not merged                                                                                                                                                           |

No fix merged since 2026-11-05 is about cancellation or cleanup, so the hub's trigger ("revisit Effect only if cancellation bugs keep coming") hasn't fired. What grew is size, and copies of the same thing.

## The spike

**The slice: 0060's tool host.** It is the gnarliest lifecycle Oriel is about to build:

- a CLI process, with control requests by ID;
- start checks;
- one call at a time, each with its own deadline;
- a run's end cancelling its call;
- nothing queued sent after a failure;
- SIGTERM, then SIGKILL.

It was written twice: in plain TypeScript, and in Effect 4.1.1. Both versions share one contract and one test, run against a fake Claude Code that is a real child process, so "kill it mid-call" kills something. They're in `packages/agent/src/tool-host/` on the branch.

**Measured:**

|                                                             | Plain                                                   | Effect                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code lines, no blanks or comments                           | 163                                                     | 208, its Promise edge included                                                                                                                                           |
| Shared test: 12 cases, 8 runs                               | 12/12 every run                                         | 12/12 every run                                                                                                                                                          |
| Kill mid-call: abort until both calls failed (median of 10) | 0.2 ms                                                  | 0.2 ms                                                                                                                                                                   |
| Close when the CLI ignores SIGTERM (300 ms grace)           | 304 ms                                                  | 304 ms                                                                                                                                                                   |
| Bugs found after it was written                             | none                                                    | 2. A detached close hadn't marked the host closed before the next call went out (my test). A second `close()` returned before the process was dead (both Effect agents). |
| `tsc -p packages/agent` (median of 5)                       | 0.46 s                                                  | 0.65 s (+41%). Files 297 → 472, memory 112 → 185 MB                                                                                                                      |
| Import cost in the server                                   | about 2 ms                                              | 150–300 ms and +23 MB heap from `effect`; 60–90 ms with deep imports                                                                                                     |
| `pnpm check` (in a heavy slot)                              | MAIN_CHECK                                              | SPIKE_CHECK                                                                                                                                                              |
| Install                                                     |                                                         | +60.8 MB: one package, no transitive dependencies. node_modules 78 → 140 MB                                                                                              |
| Shipped in the desktop app                                  | 0.9 MB of third-party packages today (preact, tinypool) | +60.8 MB, as `bundle.ts` copies packages whole. 38 MB if pruned to `dist`, 14.8 MB of which is JavaScript                                                                |
| Newest version allowed (7-day minimum age)                  |                                                         | 4.1.1. Version 4.1.2 came out 2026-11-02; Effect 4 has had 11 releases in 5 weeks                                                                                        |

**Where Effect shone:**

- Interrupting a call that waits its turn is free: the Semaphore drops it.
- `Scope` closes the process on any failure during start, with no `try`.
- Adding concurrency was one line (see the agent test).

**Where it didn't:**

- **Interruption carries no value.** The edge needs an `onSent` callback to tell "stopped before it was sent" from "stopped while out", and 0060's at-most-once write gate rests on that difference.
- **`Scope.close` isn't one close however many ask.** Both Effect bugs were lifecycle bugs, the kind Effect is meant to rule out.
- **The plain version's subtle part** was a queued call whose own run ends: a `started` flag and a listener, about 15 lines.

**The agent test.**

- **The setup:** three fresh agents (Opus 5.5, medium effort, the repo's own instructions) each got one small change on one version.
- **The change:** add a `concurrency` option, and 0060's "a server that needs signing in is a problem naming it", keeping every cancellation guarantee for every call.
- **The grading:** a hidden six-case test, which fails five of the six on the unchanged code. It's on the branch, in `spike-notes/`, beside each agent's diff.

| Version                                                                             | Time  | Hidden test, 3 runs | Lines changed in the implementation            |
| ----------------------------------------------------------------------------------- | ----- | ------------------- | ---------------------------------------------- |
| Plain                                                                               | 84 s  | 6/6 each run        | 59 (a queue rewrite)                           |
| Effect                                                                              | 121 s | 6/6 each run        | 32 (`Semaphore.make(n)`, and a fix to `close`) |
| Effect, with its source vendored in the repo (the first link's `git subtree` trick) | 120 s | 6/6 each run        | 33 (`Effect.cached` for `close`)               |

- **One run each:** this is an anecdote, not a rate.
- **Vendoring changed nothing measurable.** Effect's npm package already ships its `src/`, an `AGENTS.md` and `ai-docs/`. Both Effect agents read the Semaphore's source in node_modules to check that its queue keeps order.
- **The 2026-11-05 claim "agents write plain TypeScript better" didn't hold here.** Agents wrote Effect 4 correctly, and found a bug in it.

**TanStack AI.**

- **What it is:** a chat loop over model APIs: OpenAI, Anthropic, Gemini, Bedrock, Ollama and gateways. It has no adapter that drives a command-line agent.
- **Why it doesn't fit:** Oriel's agent runs on the person's own Claude Code or Codex, and since 0059 the product has no API-key path. So TanStack AI has nothing to run in Oriel.
- **Its Effect integration** (`@tanstack/ai-effect` 0.1.0, 2026-11-06) wraps tools for that same loop.
  - It's refused by the 7-day rule until 2026-11-13.
  - It needs `effect` ^4.1.0, plus `@tanstack/ai` and that package's seven dependencies.
- **Conclusion:** nothing Oriel would use from TanStack needs Effect.

## Why

**The 2026-11-05 arguments, tested again:**

- **"It spreads into every caller": no longer true as stated.**
  - The spike's Promise edge is about 30 lines, and the plain test ran on it unchanged.
  - The edge has a cost: interruption must be translated back into Oriel's "sent or not" at every edge.
- **"Agents and reviewers write plain TypeScript better": not shown.**
  - All three agents were correct.
  - Reviewers weren't tested.
- **"The biggest dependency by far": still true, and now measured.**
  - 60.8 MB in the desktop app, beside 0.9 MB of third-party packages today.
  - 150–300 ms on the server's start.

**SPEC §6 and 0008 decide this, not taste.**

- Oriel takes a dependency only when it is security-critical, a protocol standard or a database driver.
- Effect is none of these, so adopting it means amending §6.
- The spike doesn't earn that amendment.

**Effect doesn't fix what is unwieldy.**

- The pain is:
  - three closures of 1,200–2,600 lines;
  - two CLI sessions and four MCP servers written separately;
  - a harness branched on in 16 files;
  - a server's name kept twice.
- Effect's Layers would nudge the code toward splitting `createApp`, but the split is the same work in plain TypeScript.
- Process lifecycle is the one place Effect helps, and it's one module once the supervisor exists.

**The two versions behaved the same at runtime,** down to the tenth of a millisecond.

- The plain one was 45 lines shorter, with nothing installed or loaded.
- The Effect one was one line simpler to extend.

## Rejected

- **Effect wholesale.** It ships 60.8 MB and slows the server's start, needs a §6 amendment, and fixes nothing on the pain list.
- **Effect at named edges now: the supervisor and the tool host, behind Promise edges.** This was the closest call.
  - It would make the supervisor's concurrency and interruption shorter.
  - Against it: the whole package would ship for one module of about 300 lines.
  - Its two bugs show the lifecycle needs the same care either way.
  - Decision 5 keeps the door open.
- **Vendoring Effect's source with `git subtree`.** The npm package already carries its source and agent docs. Vendoring adds 71 MB to the repo for no measured gain.
- **TanStack AI, with or without Effect.** It's an SDK loop over model APIs. Oriel's agent is the person's own harness.
- **A "mini Effect" of our own: fibers, scopes and Layers.** That's a framework nobody chose, to save the few dozen lines one supervisor needs.

## Target structure

**packages/agent**

- **`process.ts`, the supervisor.** It owns:
  - a child process in its own empty folder;
  - JSON lines in and out;
  - Oriel's requests by ID;
  - declining every request from the child that the caller doesn't handle;
  - an idle timer;
  - a deadline and an `AbortSignal` for each request;
  - one close however many ask: SIGTERM, then SIGKILL after a grace, then the folder goes;
  - why the process ended.

  Claude Code's session, Codex's app server, the tool host and the first run's commands are built on it. It's tested with the spike's kill-mid-call test against a fake child.

- **`harness.ts`, one interface:** check, plan, provider, titler, discovery and tool host, with `claudeCode` and `codex` as its values. The server, Setup and Settings take a harness by its ID and branch on no names.

**packages/core**

- `waitsOnUser`, chip IDs and quote keys move here from web.
- `ToolCaller` takes a signal.
- The server imports only types and `files` from `@oriel/web`, and `scripts/check-repo.ts` checks that.

**packages/server**

- **`createApp` becomes wiring only,** under 400 lines. Its parts move to:
  - `connections/`: opening and shutting connections, kinds, source servers and stand-ins; sync turns and timers; connect, configure and disconnect;
  - `drafts.ts`: drafts, previews and onboarding;
  - `moves.ts`: the stand-in's move offer;
  - `wiring.ts`: the agent's dependencies and the sandbox.

  Each takes an explicit input object and returns an interface, as `turns` and `views` already do.

- **`api.ts`** becomes route files by area (threads, change sets, connections, settings and the window), with one router.

**packages/changeset**

- `change-sets.ts` splits by phase: capture and proposal, review and edits, apply and replay, revert.
- Only this package makes a writer or a `WriteCaller`, as now.

**MCP servers**

- One small stdio MCP server module serves tools only, in both revisions. `standin-mcp`, `tiny-server` and `sheets-mcp` use it, and it knows nothing of Oriel.
- Oriel's door keeps its HTTP transport and shares the module's tool dispatch.

**Known servers**

- `server/standins.ts` reads each stand-in's reported name from its connector's declaration (`knownServers`), never from a copy.

**What doesn't move:** the sandbox, the bindings and the writers.

## Order

Each story leaves main working.

1. **Known servers named once.** `standins.ts` reads `reports` from the declaration, with a test that every stand-in matches a known server. It's small, and it ends the class of mistake behind #238.
2. **The supervisor** (absorbs OA-249). Claude Code's session and Codex's app server move onto it. `server-calls.ts` gets a real signal, and `ToolCaller` takes one.
3. **0060 story 1, the tool host,** on the supervisor. The Haiku path goes.
4. **`createApp`, part one: `connections/`.** It's the largest piece and has no change a person sees. The flow tests guard it.
5. **"Waits on you" in core** (OA-250), and the import check.
6. **One harness interface.** The server, Setup and Settings stop naming harnesses.
7. **`createApp`, part two:** drafts, moves and wiring.
8. **One stdio MCP server module.**
9. **`api.ts` by area, then `change-sets.ts` by phase.**

**Closed as overtaken:**

- OA-246 and OA-247, by #232 and story 3.
- OA-248, which is only `pnpm dev` and evals since 0059. Reopen it if an eval run is lost to a 529.
- OA-244 and OA-245, unless the maintainer recalls a finding that the sites above don't answer.

## Consequences

- No dependency and no allowlist entry are added. SPEC §6 is unchanged.
- 0060's story 1 waits for story 2 here, so it's built on the supervisor, not on a third hand-written session.
- Stories 2 and 3 touch the processes the agent's turns run in:
  - both take the sol-loop's longer rounds;
  - story 3 also takes the security review 0060 already asks for.
- "Hit every surface" doesn't change for stories 4 to 9, which a person can't see. The flow tests and `pnpm check` guard them.
- If Decision 5's trigger fires, the spike branch is where to start, and its numbers are the baseline to beat.
