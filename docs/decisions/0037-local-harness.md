# 0037 The agent runs on the person's own Claude Code

Accepted 2026-11-03 (OA-187). Amends 0020. Changes SPEC §7. Builds the harness 0036's Model use asks for.

Adds: none

**Decision.**

- **The local harness is a second `Provider`, and a second `Titler`, over Claude Code.** Oriel starts the person's own `claude` headless, signed in however they signed it in, so the agent runs on their subscription. Oriel never reads, stores or relays its credentials, never offers a sign-in, and never changes its configuration: flags and environment only.
- **Which model.**
  - With `ANTHROPIC_API_KEY` in `.env`, nothing changes: the Messages API, as 0020 has it.
  - Without one, the server checks for Claude Code on its PATH, or at `--claude-code <path>`, at startup: the binary is there, `--version` is a supported one, and its answer to the control channel's `initialize` names an account. That answer makes no model request, and Oriel keeps only whether there is an account, never who it is.
  - With neither, every turn answers with how to set one up, naming no credential. The server prints the same. `--agent scripted` keeps the scripted agent for development.
  - `chooseModel` in `packages/server/src/model.ts` takes `prefer`, so the settings page (OA-181) can let a person pick. The path it is given is 0036's path set in Settings.
- **One process per turn.** `converse` starts the CLI on the first `next`, with Oriel's constant system prompt and one tool, `run`. The loop's `next(results)` answers its pending calls. Each response is read from the CLI's relay of the API's own stream events, by the same reader as the API provider, so text, calls, stop reasons, the serving model and usage arrive as they do there. A response with no calls, an abort, a failure, or the loop's new `Conversation.close()` stops the process and removes its folder.
- **How it reaches `run`.** `run` is an MCP server hosted over the CLI's own stdin and stdout, the control channel's `sdk` server type. No other process, socket, port, file or loopback route exists, so no other account or process can call it. This is 0036's per-turn capability in its narrowest form: the pipe belongs to one process for one turn. Oriel answers a call only for the call ID and the input the model streamed, once the loop has run it.
- **Earlier turns.** A fresh CLI keeps a tool result only in the same user message as the text after it. So a turn with history opens with one stand-in `run` call by Oriel, whose result is the thread so far, one JSON object a line (what the user said, what the agent said, each script and its result), followed in the same message by the user's new text. Source content stays in a tool result. The user's earlier words are there too, as the record of what they said.
- **The lock-down.** Synced content is attacker-controlled, so:
  - `--tools ""`: no built-in tool at all, no shell, files, web, edits or sub-agents.
  - `--strict-mcp-config --mcp-config` naming only Oriel's server, and `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
  - `--setting-sources ""`, `--safe-mode`, `--settings '{"disableAllHooks":true}'`, `--disable-slash-commands`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`: none of the person's settings, hooks, plugins, skills, agents, memory or instructions files.
  - `--permission-mode dontAsk --allowed-tools mcp__oriel__run`, and `--permission-prompt-tool stdio`, whose prompts Oriel answers: allow `run`, deny anything else. Permissions are never bypassed.
  - `--no-session-persistence`, and `run` declares `anthropic/maxResultSizeChars` above what a run can return, so no transcript or tool result is written under the person's home.
  - An empty folder from `mkdtemp` as its working directory, removed when it stops.
  - An allowlisted environment: home, user, PATH, temp, locale, `CLAUDE_CONFIG_DIR`, and proxy and certificate variables. No vendor key, base URL, Claude Code setting or anything else of Oriel's environment reaches it. This is stricter than 0036's "minus any vendor API-key variable".
  - **Checked each time it starts.** The CLI's `system/init` must report exactly one tool, `mcp__oriel__run`, exactly Oriel's server connected, permission mode `dontAsk`, only built-in plugins, and no skills or commands. Anything else, such as a company's managed configuration, stops it before the model's first response can act, and the turn ends with an error.
- **The caps hold.** Each response's usage is what the CLI's stream reports, recorded on the run as for the API. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` starts at what the thread's tokens leave for the first response. A later response that runs past what is left, counted from what it streamed and the CLI's own estimate of its thinking, is stopped and counted as reaching it, as `max_tokens` would. Runs per turn and the run limits are the loop's and the sandbox's, unchanged. `MCP_TOOL_TIMEOUT` is 10 minutes, so a run is never cut off by the CLI. A CLI silent for 5 minutes is stopped.
- **Titles** use the same choice: the harness's smallest model, `claude-haiku-5-5`, with the title prompt as its system prompt, no tool and no MCP server, and the person's message on stdin, never on the command line.
- **Versions.** Verified against Claude Code 2.1.314. Below it, or at 3.0 and later, the startup check refuses it, and the window says to update it. A later 2.x whose flags changed would fail its start check or its `system/init` check, and the turn ends with an error rather than run unlocked.
- **Codex isn't built yet.** It has no in-process tool server like the `sdk` type, so `run` would need a stdio MCP server process reaching Oriel through a per-turn socket. Its user `config.toml` always loads unless its home moves, which moves its sign-in too. Several of its tools (shell, patch, browser, computer use, apps) are features to turn off one by one. It is its own story, with its own lock-down checks.

**Why.**

- The maintainer's direction: run on the subscription a person already has, not API credits. 0020 planned this seam, and 0036 set its rules.
- The control channel's `sdk` server is how the CLI's own SDK serves in-process tools. It needs no second process and opens nothing another account could reach.
- Checking the CLI's report, not only its flags, catches what flags can't turn off, such as managed configuration, and a later version that ignores a flag.

**Rejected.**

- A stdio MCP server process that reaches Oriel over a socket or a loopback port. It works, but adds a process and an endpoint to protect.
- `--bare`. It skips the most configuration, but then signs in only with an API key, never a subscription.
- Keeping one CLI per thread across turns. History would survive only while the process does, and a restart would still need the replay above.
- Passing the person's whole environment minus a deny list. A new variable that steers the CLI would pass by default.

**Consequences.**

- `Conversation` gains an optional `close()`, which the loop calls once when a turn ends, however it ends.
- Evals keep replaying their API cassettes. The harness has unit tests against a stand-in CLI, and `claude-code.live.test.ts`, which starts the real CLI only with `ORIEL_LIVE_CLAUDE_CODE=1`, in a folder planted with instructions files, hooks, an MCP server and bypass settings that must not load.
- `pnpm dev` without a key now uses the developer's Claude Code, or says how to set one up; `--agent scripted` is the old default.
- Responses arrive in the CLI's stream chunks, so text streams as it does from the API. Its prompt caching is its own.
- Revisit for Codex, for a CLI version that changes a flag, or when 0036's shell gives the server the login shell's PATH.
