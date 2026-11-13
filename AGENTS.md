# Oriel

Spec: `SPEC.md`. Use its glossary (§2) exactly, in code and prose. Decisions: `docs/decisions/`.

No UI copy that merely restates a visible label or obvious interaction.

Almost no code comments. Write one only when reading the code can't tell you why: a security invariant, an outside system's quirk, a workaround with its link. Never what the code does, a story key, a decision number on its own, or the change's history; those belong in the commit, the PR and `docs/decisions/`. Rename or restructure before explaining. The existing code is heavily commented; don't copy that.

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
