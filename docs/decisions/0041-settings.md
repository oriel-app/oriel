# 0041 Settings: providers, models and the look, kept by the server

Accepted 2026-11-03 (OA-181). Amends 0020, 0024, 0034 and 0037. Changes SPEC §7. Amended by 0042: on the desktop app, the API key's row takes a key, checked with Anthropic and kept in the OS secret store; `POST /settings/key` is exempt too. Amended by 0043: a Notifications section, one switch, on by default, for the desktop app's notifications. Amended by 0045: a General section, with Ask before quitting while Oriel works, on by default, on the desktop app. Amended by 0046: Providers shows how much of the plan Oriel has used, under Claude Code; General gains Times, relative or absolute. Amended 2026-11-03 (OA-112, #153): General gains After you approve: stay on the thread, the default, or go to the next thing that needs you. Amended by 0049: a Connections section, whose routes go through the dispatcher. Amended by 0051: the agent may read a connection's options and draft them; Settings stays out of its reach. Amended by 0059: Settings drops the API key, and gains which kinds are on and how often sync runs. Amended 2026-11-08 (0059's API key removed from the product): Providers lists no API-key row on the desktop app or `pnpm dev`, and has no key field; with no AI on, Source servers says so on every row and points to Providers, and its Look again checks the providers again first. Amended 2026-11-11 (OA-353): the overview's ask bar is gone; its composer grows as every other does, so Enter follows Settings › Send there too, and "the ask bar is one line, so Enter always asks there" no longer applies.

Adds: none

**Decision.**

- **A settings page,** opened from the foot of the sidebar, with its sections down the left, each its own address (`/settings`, `/settings/appearance`, `/settings/asking`), so a section is added with a route and a component. Every change applies at once, with no Save.
- **Where settings live.** One JSON file, `settings.json`, in the data folder: `.oriel/` under `pnpm dev` (with `--fresh`, its folder), and the folder 0036's desktop mode names. It is written whole and renamed into place, readable by its owner only. A field it can't read falls back to its default alone. It holds no key or credential.
- **Providers.** A provider instance is one way to reach a model: `{ id, kind, name, on, path? }`, of kind `claude-code`, `codex` or `api`. Settings lists one of each by default. A second account of a kind is another instance with its own ID and display name, and its own options (a path now, a config folder later). Nothing adds one from the page yet.
  - Oriel looks for every instance at startup, and again on Check again or when a path changes: the key in `.env`; Claude Code by 0037's own check (`--version`, then the control channel's account answer); Codex only by a file on the PATH, which it never runs (0040).
  - Each row shows its status (ready, not found, needs an update, not signed in, no key, not supported yet, checking), the CLI's version, the models it runs now, and an on/off switch. The API key's row says only whether a key is set. Codex's row says 0040's reason and has no switch.
  - A path for Claude Code, set in its row, wins over `--claude-code` and the PATH. It must be absolute and name the `claude` program. The page can set one only on the desktop app, behind its launch secret. Under `pnpm dev` the guard checks only Host and Origin, which another account on the machine can forge, and a path is a program the server runs as the person; so there the path is `--claude-code`'s, and the page refuses one.
- **The default model and the Title model** are each an instance and one of its models: Opus 5.5, Sonnet 5.5 or Haiku 5.5. They're picked only from instances found ready and turned on; the server refuses anything else. With no pick, the key wins, then Claude Code, with Opus 5.5, as 0037 has it; titles follow the default's instance with Haiku 5.5.
  - **Each turn and each title chooses again.** The server's agent and titler look up the pick when a turn or a title starts, and build the provider for it once per instance, model and CLI. A change applies at the next turn of every thread and the window chat, and the next title, with no restart. A turn already running finishes on what it started with.
  - With nothing usable, a turn says why: every provider is off, or 0040's Codex line when only Codex is there, or the CLI's own problem.
  - `chooseModel` and `modelOptions` (0037) become `models()` in `packages/server/src/model.ts`.
- **Appearance.** The theme, from `themeNames()` over `window.css`, and the text size: small, default or large, which sets the root's font size so every rem follows. The server writes both into the page shell's `<html>` (`data-theme`, `data-text-size`), so the first paint is right with no script (0034). Picking one sets the attribute at once. A review link's page always has the default look.
- **Asking.** Enter sends a question, Shift+Enter a new line; or Cmd+Enter (Ctrl+Enter) sends and Enter is a new line. It applies in a thread, the window chat and a workstream's page. The ask bar is one line, so Enter always asks there.
- **Settings are the person's, not Oriel's data.** No agent, outside tool or review link can read or change them: their routes don't go through the dispatcher (0024), and the repo check lists them as exempt, with that reason. They sit behind the same guard as every route, and the desktop app's launch secret (0036).
- **Telemetry:** `theme.picked`, by name, once per change of theme.

**Why.**

- The maintainer asked for the start of a settings page with providers first, as the coding app Oriel runs beside does, and 0036 and 0037 both left the pick and the path to it.
- Choosing per turn is what makes "applies at once" true without restarting the server, and keeps a running turn on one provider.
- A file in the data folder is the smallest store that the desktop app and `pnpm dev` share, and the server must know the look before the page's first byte. A row in the database would tie a person's preference to one Jira mode's database.
- Settings choose which program the server starts on the person's machine. An agent that could change them could point Oriel at another CLI, so they stay out of the agent's reach entirely.

**Rejected.**

- **A Save button.** Every setting is one small change the server checks at once.
- **Settings in the browser's storage.** The server couldn't write the first paint's look, and a new port loses it (0036).
- **Settings as Oriel actions closed to the agent.** The dispatcher exists so every door gets the same actions. These have one door, the person's.
- **Adding an API key from the page.** The desktop app keeps it in the OS keychain, which its own story builds. Until then the page says whether `.env` has one.

**Consequences.**

- 0020: `titleModel` is now the Title model's default; Settings picks the model and its provider.
- 0024: two more exempt routes, `POST /settings` and `POST /settings/look`.
- 0034: the preference is stored in `settings.json`; the theme section exists.
- 0037: `chooseModel`'s `prefer` and configured path are Settings' picks and a row's path.
- Later, not built: a desktop notification when something needs the person, asking before quitting while a turn runs, a timestamp format, how much of a subscription Oriel has used, adding a second account from the page, and the API key in the keychain.
