# Climb show-ignored: `chart-in-progress-by-person` from about 5 in 10 to at least 8 in 10

OA-240. This plan was committed before the climb's first live round. `show-ignored.json` freezes the cases, groups, trials a case and cap; `show-ignored.ledger.jsonl` books every round.

## What the evidence shows

- `chart-in-progress-by-person` passed 5 of 10 live draws after OA-241 (`module-shrink.md`), against 3 of 4 on the text before it.
- Every miss there read `history()`, not `window.overview()`, asked for bars with a `label` and no `value` (and a stray `title`), was refused, and then showed a pivot of in-progress items by assignee. That pivot answers the question. The misses failed two graders: `blocks` (it wanted bars from `window.overview()`) and `no-refused-block`.
- Every recorded pass sends `title` too (the cassettes, and seven replays in other worktrees), so a refusal of any key a form doesn't take would fail the case on its passing path. Unknown keys are therefore named in a note on a shown block, not refused.
- Bars are the one form that can't count: a series counts rows without `value`, and a pivot "sums `value`, else counts". So a natural first try from `history()`, counting in-progress items by assignee, has no spec that bars accept.

## Before the freeze (the climb's starting state, not judged as a change)

- **The case:** `chart-in-progress-by-person` was written before `history()` existed (#181, before #191). It now takes bars or a pivot from `window.overview()` or `history()`, as `chart-who-overloaded` already does. `no-refused-block` stays. Changing the grader alone leaves the miss above a miss, since it was refused once.
- **The story's own change (F1),** which ships whatever the climb finds and is unit-tested:
  - a shown block's result names the keys its form doesn't take (`filter`, `title`, …), keys alone and capped, and says only `where` keeps some rows;
  - a refused spec leads with what its form lacks or got wrong, by key (`a bars block needs \`value\``), then the full help as before;
  - the key list comes from `blockSpec` itself, so agent/blocks.ts's copy of it goes.
  - The test step's trim bar is F1's guard: `F1` is in every arm after main's.

## Frozen

- **Cases:** 7, in `show-ignored.json`, a subset climb.

  | group    | train                                                                                                                                                                                       | test                                             |
  | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
  | target   | `chart-in-progress-by-person`                                                                                                                                                               |                                                  |
  | blocks   | `chart-bugs-in-progress` (the story's `filter` case), `chart-who-overloaded` (bars or a pivot by person, from `history()` too), `chart-points-by-assignee` (bars with `value`, in a region) |                                                  |
  | region   |                                                                                                                                                                                             | `rows-checkout-stories`, `table-weather-stories` |
  | overview |                                                                                                                                                                                             | `table-workstreams-quiet`                        |

  The splits are the case files' own. `chart-workstream-sizes` is still `waiting`.

- **Trials a case:** k = 8. With the target at 50% on a baseline of 2k = 16 trials, a candidate passing 8 of 8 is kept at p ≈ 0.02 (one-sided exact), and 7 of 8 is not (p ≈ 0.14). The three guard cases ran at or near 100% in the replays and the recordings, so they add little noise. A smaller k can't clear the bar at all with one miss; a larger one doesn't fit the cap. The method can miss a fix that leaves one miss in 8; the done bar below is counted separately.
- **Cap:** $6 in the ledger. A train round is 32 trials, about $0.8; a test round 24, about $0.6.
- **Method:** decision 0031's settings, unchanged (`method` in src/compare.ts: alpha 0.05, guard 0.10, margin 8 points).

## Rounds and money

| step                                                               | trials | estimate |
| ------------------------------------------------------------------ | ------ | -------- |
| `B1`, `B2`: the starting state (F1), train; `aa B1+B2`             | 64     | $1.6     |
| `F2`: fix F2, train                                                | 32     | $0.8     |
| `T0a`, `T0b`: main's agent text, test                              | 48     | $1.2     |
| `Fall`: the final state, all cases (records the climb's cassettes) | 56     | $1.4     |
| `Ft`: the final state, test                                        | 24     | $0.6     |
| **total**                                                          |        | **$5.6** |

Re-recording every case afterwards is a plain `pnpm evals`, outside the ledger. There is no top-up round of a kept fix: no trim follows it.

## Changes to try, in order

1. **Fix F2: bars count the rows that share a label when given no `value`.** `value` becomes optional on bars, as on a series and a pivot; the caption says "counted". The refusal help says "Bars take `label`, and `value` to sum (else Oriel counts the rows)". No module bytes: `show()`'s type leaves form fields open, and the help is a refusal's text.

There is no second fix. If F2 is reverted, the branch ships F1 and the report says the case is still flaky.

## Keeping a fix

1. **Train, against `B1+B2`:** better beyond noise (p ≤ 0.05), and no group worse (p ≤ 0.10).
2. **Test:** `compare T0a+T0b Fall+Ft --trim` on test: no worse within 8 points, and no group worse.

**The done bar** (the story's): the target passes at least 8 of 10, counted over the final state's draws (`F2` and `Fall`, 16 draws, so at least 13).

I read train transcripts only. Test runs once per arm, at the end.

## Deviations

## Log

| round | state | trials | verdict | cost |
| ----- | ----- | ------ | ------- | ---- |
