# 0061 Eval cases earn their place, grade exactly, and are recorded at night

Accepted 2026-11-08. Changes SPEC §8.

Adds: none

**Decision.**

- **A case earns its place.** It stays only if it guards a model failure seen in a live round, a recording or dogfood, caught a regression on a real change, or is a climb's target. Prompt-injection cases stay regardless: they guard the threat model. A SPEC §8 promise keeps its strongest case, so no promise is left with none. A feature gets no case for its happy path.
- **Grade exactly where we can.** The calls made, a change set's ops, a golden diff, text held or avoided. A golden holds only what the case guards. The judge stays only for prose with no exact form: today `chart-finish-checkout` (kind 7) and `scope-promo-codes` (kind 8).
- **No flaky mark.** Replay is deterministic, so flakiness only bites when a draw is recorded. The night's recording draws a case again, up to twice, when its draw would fail the replay, and reports every first-draw failure. `failing` stays for a case the agent fails on every draw.
- **Cassettes are recorded at night, on main.** A T3 scheduled task on the maintainer's Mac runs `scripts/nightly-evals.ts` once a night in a fresh checkout of origin/main, with the main checkout's `.env` read only for the model key. CI never holds a model key. It opens a recording PR with the cassettes and `packages/evals/nightly.json`, and a summary: each split's first-draw pass rate against the last night's, cases newly failing, cases drawn again, spend. The task enqueues it when the replay passes and nothing newly fails; otherwise the hub decides.
- **Stale cassettes during the day.** A PR that changes what the agent is sent, or adds a case, adds `packages/evals/stale.md`, a line each saying what changed. While it exists, a replay that misses a cassette calls the case stale and passes it; any other error or failed deterministic grade still fails. The night's recording removes it.

**Why.**

- 53 cases, 20 of them never failed on anything but noise, and most were added with the feature they describe. Each costs a recording draw on every agent-facing PR, and its flakes block PRs.
- Recording on each PR's branch right before merge serialised agent-facing PRs behind the hub: each merge made the next PR's cassettes stale.
- Exact graders don't flake and cost no judge call.

**Rejected.**

- A CI workflow that records: CI would hold a model key.
- A `flaky` mark (the old head of #233, `e202c361`): with re-draws at night, it guards nothing replay doesn't.

**Consequences.**

- A regression is caught before merge by the replay of every case whose requests didn't change, the module and prompt budgets, and, for an agent-facing PR, a live round (`pnpm evals`) by whoever holds the key, reported against `nightly.json`. After merge, the next night names any case newly failing.
- A night the Mac sleeps is skipped; `stale.md` stays, and the next night records everything.
- The add-eval skill says the keep rule.
