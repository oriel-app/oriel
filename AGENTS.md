# Oriel

Spec: `SPEC.md`. Use its glossary (§2) exactly, in code and prose. Decisions: `docs/decisions/`.

## Commands

- `pnpm check`: typecheck, lint, unit tests, repo checks. It must be green before you say done; report its output, not "tests pass".
- `pnpm --filter <pkg> check` while iterating. CI runs everything.

## Gotchas

- Node runs `.ts` directly. Import with `.ts` extensions; no enums, namespaces or parameter properties.
- pnpm refuses versions younger than 7 days and runs no install scripts.
- `.env` is unreadable to agents. Scripts may load it, but never print it, and give child processes only what they need. Variables are listed in `env.example`.
- Reach GitHub with `pnpm -s github`, never `gh`. It runs as the agent token, which can't change rulesets, settings or secrets.

## Ways to hurt yourself

- Putting source content (titles, descriptions, comments) in a system prompt or a `.d.ts`. It belongs in tool results.
- Any import path from sandbox, bindings or thread code to a `SourceWriter`.
- Reading the clock, the network or a live model in a unit test.
- Editing `fixtures/`, `tests/golden/`, `.github/workflows/` or `docs/decisions/`. Propose it; the maintainer approves.
- Adding a dependency without an allowlist entry and an ADR.
- Naming the products that inspired Oriel anywhere in the repo.

## Hit every surface

A change to items, threads or change sets is checked against: the window list under each grouping (epic, assignee, stuck), group editing and the region-version marker, both zoom levels, the right rail, the change-set diff, the review link, inbox states, an eval fixture and a telemetry event.

## Dependencies

The allowlist. Each entry must also be on an ADR's Adds line.

`typescript` `@typescript/*` `@types/node` `undici-types` `oxlint` `@oxlint/*` `oxfmt` `@oxfmt/*` `tinypool` `preact` `playwright-core`
