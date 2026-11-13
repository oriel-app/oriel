# Oriel

Spec: `SPEC.md`. Use its glossary (§2) exactly, in code and prose. Decisions: `docs/decisions/`.

No UI copy that merely restates a visible label or obvious interaction.

Almost no code comments. Write one only when reading the code can't tell you why: a security invariant, an outside system's quirk, a workaround with its link. Never what the code does, a story key, a decision number on its own, or the change's history; those belong in the commit, the PR and `docs/decisions/`. Rename or restructure before explaining.

## Commands

- `pnpm check`: typecheck, lint, unit tests, repo checks. It must be green before you say done; report its output, not "tests pass".
- `pnpm --filter <pkg> check` while iterating. CI runs everything.
- Which layer a change gets a test at, and which unit tests stay: the `unit-tests` skill.
- `pnpm perf`: the window's open on a 4,000-item world, in Chrome, against its budget. Run it after touching the index, the overview or Browse.
- `pnpm ui-check` when you touch `packages/web`, and fix the page it names in the same PR.
- `pnpm ui-test`: the window's behaviour tests, in parallel, with no pictures; CI's ui job runs them. Run it when you touch `packages/web` or `scripts/shots.ts`. `pnpm shots` takes pictures, which are evidence for review, not a test (decision 0063).
- `pnpm desktop:try <scenario>`: the built desktop app, hidden, on a fresh data folder, with its secrets in memory. See `packages/desktop/README.md`.

## Gotchas

- Node runs `.ts` directly. Import with `.ts` extensions; no enums, namespaces or parameter properties.
- pnpm refuses versions younger than 7 days and runs no install scripts.
- `.env` is unreadable to agents. Scripts may load it, but never print it, and give child processes only what they need. Variables are listed in `env.example`.
- Reach GitHub with `pnpm -s github`, never `gh`. It runs as the agent token, which can't change rulesets, settings or secrets.
- `packages/web/src` imports only types from other workspace packages (`import type`). A value import passes `pnpm check`, but the browser bundle can't load it and the window renders blank.
- A button's tooltip is `<Tooltip text>` (`packages/web/src/tooltip.tsx`), never `title=`.
- The `prefers-reduced-motion` block stays last in `window.css`. New motion goes above it, with its selector added to the block; a rule after it wins and re-breaks reduced motion.
- A page model with its own notice field adds it to `cameBack` (`packages/web/src/came-back.ts`), or after a restart that page keeps "Oriel can't be reached".
- F8 belongs to the whole window (the bead). Keydown handlers leave it alone.
- Under the item panel, build on `PanelDockContext` (`packages/web/src/dock.tsx`): one composer path, and one follow-the-end hook for every chat.
- A local path sent to the window goes through `homeRelative` (`homeExpanded` for a saved `~/…`) in `packages/core/src/home.ts`. The window never shows `/Users/<name>`.
- A Messages API request goes through `messagesSender` (`packages/agent/src/anthropic.ts`); its error text comes from `errorText` and `causeOf` (`packages/agent/src/provider.ts`). No second sender or formatter.
- Free text, anything a person or the agent typed, goes through `parseDeclared`, never `parseItemId`. Source kinds are declared in `packages/sources`, not core.
- A worker thread that starts processes calls `relayChildren()` (`packages/sandbox/src/children.ts`). Nothing long-lived uses `execFileSync` or `spawnSync`.
- A new desktop launch argument goes in `shellSwitches` (`packages/desktop/shell/rules.ts`), or the app exits 1.
- A dev server in a worktree runs with `--agent scripted`: `auto` picks Codex, which refuses the worktree's AGENTS.md as outside instructions.
- In `scripts/shots.ts`, new scenes go at the end; code for `page.waitForFunction` is a string; a click just after the rail moves waits for `data-carrying` to go; a scene that starts or holds a drag calls `letGo(page)` first. `node --test` runs any `*-test.ts`, so only unit tests get that name.
- An agent-facing change (the prompt, the module, tools, anything a cassette's hash covers) adds a line to `packages/evals/stale.md`. Don't record cassettes; the night's recording on main does, and removes the file. A change to the stand-in tracker's or Linear's module text updates `tests/golden/module-{tracker,linear}.txt` in the same PR, for the maintainer to approve.

## Ways to hurt yourself

- Launching the desktop app any other way than `pnpm desktop:try`. Its window and Keychain prompts land on the maintainer's screen.
- Putting source content (titles, descriptions, comments) in a system prompt or a `.d.ts`. It belongs in tool results.
- Any import path from sandbox, bindings or thread code to a `SourceWriter`.
- Reading the clock, the network or a live model in a unit test.
- Editing `fixtures/`, `tests/golden/`, `.github/workflows/` or `docs/decisions/`. Propose it; the maintainer approves.
- Adding a dependency without an allowlist entry and an ADR.
- Naming the products that inspired Oriel anywhere in the repo.
- Squashing with `git reset --soft origin/main` after main has moved. Your branch keeps its stale copies of whatever merged since, and the PR silently reverts it. Squash onto `git merge-base HEAD origin/main`, then rebase. Before opening or merging a PR, `git diff --stat origin/main...HEAD` lists only your own files.

## Hit every surface

A change to items, threads or change sets is checked against: the overview (workstream cards, Not in a workstream yet, the window chat, pins), Browse under each grouping (epic, assignee, stuck, linked), workstream editing and the region-version marker, a cluster open and closed, the item panel, the right rail, the change-set diff, the review link, thread states (Needs you, the Done page), a thread's blocks, an eval fixture, a telemetry event and its page in packages/design-system.

## Dependencies

The allowlist. Each entry must also be on an ADR's Adds line.

`typescript` `@typescript/*` `@types/node` `undici-types` `oxlint` `@oxlint/*` `oxfmt` `@oxfmt/*` `tinypool` `preact` `playwright-core`
