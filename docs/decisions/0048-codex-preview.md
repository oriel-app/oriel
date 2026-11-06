# 0048 Codex runs Oriel's agent, as a preview

Accepted 2026-11-03. Supersedes 0040. Amends 0036, 0037, 0038, 0041 and 0046. Changes SPEC §7 and the security reviewer's checklist. Amended by 0059: on Codex, sync calls a source server's read tools through the app-server, with only that server enabled.

Adds: none

**Decision.**

- **Codex is a second command-line agent, labelled Preview.** The maintainer overruled 0040: "i dont want codex to not be an option". Claude Code stays the default whenever both are ready. The maintainer accepts three risks 0040 named:
  - Codex's read-only sandbox can still read files on the Mac, through any tool Oriel couldn't turn off;
  - the person's own Codex settings load;
  - the harness can't verify the tools Codex gives its model.
- **The harness** is a third `Provider` and `Titler` over 0037's seam, in `packages/agent/src/codex.ts`. Oriel starts `codex app-server` for each turn, over its stdin and stdout, signed in however the person signed it in. `run` is its one client tool (`dynamicTools`). Codex asks Oriel to run each call (`item/tool/call`) on the same pipe, and Oriel answers with the loop's result, so no other process, socket or port exists. Earlier turns go in as one stand-in `run` call and its result (`thread/inject_items`), as 0037 does it.
- **Oriel's prompt.** `baseInstructions` replaces Codex's own prompt with the same constant system prompt the API and Claude Code use, and `developerInstructions` is empty. Titles use the title prompt the same way. Source content stays in tool results.
- **The lock-down.** As far as Codex lets it go:
  - The read-only sandbox, which Codex runs with no network.
  - The approval policy `untrusted`, reviewed by the user, so every command and file change Codex wants comes to Oriel. Oriel declines every one, and every other request Codex makes of it, except a `run` call. One function, `codexAnswer`, decides that.
  - Every feature switch the installed version has that gives the model a tool, loads something of the person's or reaches past the turn, off (`codexFeaturesOff`): shells, images, goals, sub-agents, plugins, apps, skill search, hooks, memories, browsers, computer use and the rest. Code mode's host stays on, because the models a ChatGPT plan serves reach client tools only through its `exec` (see Why). A switch name the CLI doesn't know stops it starting, so a release that drops one fails closed.
  - `-c` settings, which outrank the person's `config.toml`: no web search, no instructions files, no skills' instructions, no bundled skills, no `notify`, no developer instructions, no history, no update check, no analytics, and a shell environment of nothing.
  - The thread's own settings turn off each MCP server `config/read` names, and each skill `skills/list` names. Codex has no switch for all of them.
  - An ephemeral thread, in an empty folder from `mkdtemp`, removed when it stops.
  - 0037's allowlisted environment, with `CODEX_HOME` in place of `CLAUDE_CONFIG_DIR`.
  - Oriel's own reasoning effort on every turn, never Codex's `ultra`, which hands work to sub-agents.
- **Checked at each thread start, before the model can act.** `thread/start`'s report must show the read-only sandbox with no network, the `untrusted` policy reviewed by the user, Oriel's folder, and no instructions file outside Codex's home. `mcpServerStatus/list` must show every MCP server disabled, and `hooks/list` no hooks. Anything else, such as a company's managed configuration, stops Codex and the turn ends with an error.
- **Checked during the turn.** Any item but the person's message, the model's message and reasoning, a `run` call, a file change or Codex compacting its own context stops the turn the moment Codex starts it: a shell command, an MCP call, a web search, an image or a sub-agent. A file change waits on Oriel's approval and is declined.
- **What the model gets,** on Codex 0.166.0 with the person's default model, `gpt-6.1-sol`, measured as in Why:
  - `exec`, which runs JavaScript in an isolate with no files, network or console, and can call `run`, `apply_patch` (declined), the three MCP resource tools (no server is on) and a clock;
  - `wait`, for `exec`;
  - `request_user_input` and `request_user_input_async`, which Codex refuses itself in its default mode;
  - six sub-agent tools (`spawn_agent` and the rest), which stop the turn if used.
- **What of the person's configuration still loads:** the rest of their `config.toml`, such as their model provider, base URLs and profiles; their own `AGENTS.md` in Codex's home, which reaches the model as their instructions; and their managed configuration, which outranks every flag and which the start check catches only where Codex reports it.
- **Where it shows up.**
  - Settings and the first run show Codex's row once it's installed, marked Preview, with one line: "Less locked down than Claude Code: your own Codex settings still load, and Oriel can't check every tool Codex gives its model." It has a switch, a path field like Claude Code's, and the plan's usage.
  - Its models are the ones `model/list` reports. With nothing picked, the key wins, then Claude Code, then Codex on its own default.
  - The first run picks Claude Code whenever it's ready; Codex only when it's the one ready, with Continue with Codex and the same test turn.
  - With only Codex installed and signed out, a turn says Codex's own sentence. On the desktop app, a turn with no AI points to Settings for Claude Code or Codex.
- **Sign-in** is Codex's own `codex login`, started as 0038 starts `claude auth login`: a child in its own process group, stdin closed, its log redacted. Codex opens the person's browser on OpenAI's page, which hands the sign-in back to Codex's own listener on `127.0.0.1:1455`. Signed in is Codex's own `account/read`, which also gives the row the plan and email, shown and never kept. Oriel never reads `auth.json` or any credential, and never changes the person's Codex configuration.
- **No paste field.** `codex login` reads nothing from its stdin, so a URL written there would do nothing. The browser's hand-back is local to the Mac, so it fails only when the port is taken, which Start again answers.
- **No install or update.** Codex's row shows once it's installed. One too old says to update it the way it was installed, naming npm's or Homebrew's command where its path shows which.
- **Titles** follow the default's provider until the person picks. With Codex alone, they run on Codex's default model at low effort, locked down as a turn is, with no tool.
- **The caps hold.** Codex counts a response that called `run` only after Oriel answers the call. Until then, that response reports an estimate: at least the last response's input or, for the first, the request's size, and what it streamed. So the thread's token cap stops a run no response could read, as 0037's does, and Codex's own count later adds only what the estimate missed. A response past what the thread's tokens leave is interrupted and counted as reaching it.
- **Usage (0046).** Codex's own `account/rateLimits/read`: the five-hour window and the week, by their length in minutes. Oriel counts Codex's turns and tokens as it does Claude Code's.
- **Versions.** 0.166.0 and any later 0.x. 1.0 is refused until it's checked, and its row says Oriel's next update will work with it.
- **On localhost** too, without a key or Claude Code, the person's Codex runs as this preview.

**Why.**

- The maintainer's call, with the risks above accepted. 0040's three conditions still aren't met: the app server has no client-tool allowlist and no way to skip the person's configuration, and nothing reports the tools the model sees.
- Measured on the maintainer's Mac against Codex 0.166.0, the same version as 0040, by pointing Codex at a stand-in model endpoint on localhost and capturing its request, with an empty or planted `CODEX_HOME` and no sign-in:

  |                                                           | tools the model gets                                                                                                                                         |
  | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | app server, defaults, `gpt-5.5`'s metadata                | `exec_command`, `write_stdin`, `request_user_input`, `apply_patch`, `view_image`, 3 goal tools, `run`, `tool_search`, `web_search`                           |
  | the lock-down, `gpt-5.5`'s metadata                       | `request_user_input`, `apply_patch`, `run`                                                                                                                   |
  | the lock-down, `gpt-6.1-sol`'s metadata (today's default) | `exec` and `wait` (`exec` reaching `run`, `apply_patch`, 3 MCP resource tools, a clock), `request_user_input`, `request_user_input_async`, 6 sub-agent tools |

- **Code mode comes from the model, not the configuration.** Today's models' metadata puts their tools behind `exec` and adds sub-agent tools, whatever the switches say. With code mode's host off, `run` was unreachable: the live turn never called it. With it on, `exec` calling `run` reaches Oriel as an ordinary `run` call. Sub-agents can't be switched off: `agents.max_threads` must be at least 1.
- **What a planted `CODEX_HOME` showed.** Its `config.toml` set an MCP server, `notify`, hooks, developer instructions, `approval_policy = "never"`, `danger-full-access`, live web search and the shell tool; it also had an `AGENTS.md` and a skill. Under the lock-down, the MCP server and the hooks never started, `notify` never ran, the developer instructions and the sandbox and approval settings were Oriel's, and Codex reported the read-only sandbox. The `AGENTS.md` reached the model. A `$skill` mention in the user's text attached the skill's `SKILL.md` from disk until the thread turned that skill off, so every skill Codex reports is turned off; an `@path` attached nothing.
- **What a live turn showed** (`codex.live.test.ts`, on the maintainer's own sign-in, `gpt-6.1-sol` on ChatGPT Plus), from a folder planted with a project `config.toml` (an MCP server, hooks, `notify`), an `AGENTS.md` and skills: the model called `run`, its `apply_patch` was declined and wrote nothing, and nothing planted loaded or ran.
- **Codex's sign-in without a terminal.** With stdin closed and the browser blocked, `codex login` printed its listener and OpenAI's link and waited; it read no input. 0038's measurements of `codex login` still stand.
- **Not the oracle's way.** A desktop app that drives Codex asks the person to paste the final localhost URL when the sign-in doesn't come back, and fetches it for Codex's listener. That passes the sign-in code through the app, which 0038 rules out.

**Rejected.**

- **A "Paste the URL from your browser" field writing to Codex's stdin.** Codex reads none.
- **Fetching a pasted localhost URL for Codex's listener.** It passes the sign-in code through Oriel (0038).
- **`codex login --device-auth`,** which shows a one-time code to type on OpenAI's page. It's the way in if the browser's hand-back fails in practice, but it needs device sign-in turned on in the person's ChatGPT settings first.
- **Code mode's host off.** Today's models can't reach `run` at all.
- **Replacing Codex's model catalog (`model_catalog_json`)** to drop `exec`, `apply_patch` and the sub-agent tools, and **an empty `CODEX_HOME`**: as 0040.
- **Turning off each item of the person's `config.toml` by name.** A deny list, as 0040 says. Only MCP servers and skills are turned off by name, because Codex reports them, and the start check confirms it.
- **Refusing a person's own `AGENTS.md`.** It's their own text, as their own Codex settings are, which the maintainer accepted. One from anywhere else is refused.
- **Installing Codex.** Not built. If it is, it uses OpenAI's own installer, `https://chatgpt.com/codex/install.sh`, with a signature check against OpenAI's Team ID, `2DC432GLL2`, as 0044 does for Anthropic's.

**Consequences.**

- 0040 is superseded.
- 0036: "a CLI that can't run that way isn't supported" holds for every CLI but Codex, which runs as this preview.
- 0037: `models()` has a third kind. Its harness rules hold for Claude Code.
- 0038: Codex's row has Sign in, and the first run's lines for ChatGPT subscribers point at it.
- 0041: Codex's row has a switch and a path, and its models are Codex's own.
- 0046: Codex's row shows its plan's windows and Oriel's own counts.
- SPEC §7: the model-access line, and the setup's telemetry, which now says which agent (`cli` on `cli.started`, `cli.ended` and `first-run.test-turn`, and `codex` as an AI chosen). An event without `cli` was Claude Code's.
- The security reviewer looks for anything that widens the preview's accepted exceptions.
- `codex.live.test.ts` runs only with `ORIEL_LIVE_CODEX=1`. It spends a little of the person's plan, and also measures the tools against a stand-in model with a planted home of its own, never the person's.
- **Follow-up: writes to a connected folder.** The maintainer wants agents to write to a person's connected folder. That comes as its own story, for every agent: a write becomes a change-set mutation the person approves as a diff, like a Jira edit, through `run`. Codex's own file changes stay declined, in `codexAnswer`.
- **Revisit** for each Codex release that changes `codex app-server generate-ts --experimental` or `codex features list`, and when Codex offers a client-tool allowlist, a way to skip the person's configuration on the app server, or a report of the tools the model sees.
