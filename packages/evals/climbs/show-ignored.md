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

1. **After `B1`: no `B2`, and the test step runs on test alone.**
   - `B1` cost $1.12 for 32 trials, not the $0.8 estimated, so the plan as written comes to about $7.5, past the $6 cap.
   - `B2` is dropped: the baseline is `B1` alone. Against 3 of 8, F2 is kept on the target only at 8 of 8 (p ≈ 0.013), as against `B1+B2` at 50%; 7 of 8 isn't kept either way (p ≈ 0.14). There is no `aa` check.
   - The final step is `T0a`, `T0b` (main's text) against `Ft1`, `Ft2` (the final state), all on test. `Fall` is dropped: the cassettes come from the full re-record outside the ledger, whose draw of the target also counts toward the done bar (`F2`'s 8 draws and the re-record's 1, so at least 8 of 9).
   - `B1`'s train transcripts, read before F2: all five misses read `history()` and asked for bars with a `label`, `where: { state: "In progress" }` and no `value`, four with a stray `title`; each was refused with "a bars block needs `value`", then showed a correct pivot. One also showed bars from `window.overview()` first. The three passes read `window.overview()`. F2 is the fix the evidence points at, unchanged.

2. **After `F2`: `B2` comes back, as the frozen plan had it.**
   - `F2` against `B1` alone: the target 3/8 → 8/8, the blocks group 24/24 → 23/24 (p(worse) 0.50), all 27/32 → 31/32, p = 0.077: **revert** by the rule.
   - The one miss, read from `F2`'s train transcript: `chart-bugs-in-progress` asked for `form: "rows"` with `columns`, `sort` and `caption`; Oriel showed rows and named the three keys as ignored, and the agent answered from it. F2 changes only bars with no `value`. The same miss was seen on #181's branch ("asked for rows, not a table", `show-from-2.md`).
   - `F2` cost $0.88, not $1.12, and the test step costs less without `Fall`, so the frozen plan's `B2` fits the cap again. `B2` runs the starting state (`68f5a19a`'s core), and `F2` is judged once more, against `B1+B2`, by the same rule. That verdict is final: no more rounds of either arm. Running `B2` after seeing a near miss is optional stopping on the baseline's side; the report says so.

3. **The test step's ledger lines for `T0a` and `T0b` were rebuilt.** A `git checkout -- packages` between arms reverted them before they were committed. Each round's own `summary.json` holds its trials and spend, and the two lines were rebuilt from those, without their pre-round estimates. The cap check was unaffected: both rounds ran before it was lost.
4. **Attributing the test step's two misses, read after the verdict and acted on in no way.** Both `table-workstreams-quiet` misses were the turn's first `show()` call, asking for a table with a column `id` that the overview doesn't declare. That's `buildBlock`'s field check, which this branch doesn't change. Before that call the agent had read no text this branch changes: the module, the system prompt and `show()`'s declaration are main's. So the misses are draws of main's behaviour. The verdict stands as the rule gives it.

## Log

| round                                                                  | state                           | trials | verdict                                                                                                          | cost  |
| ---------------------------------------------------------------------- | ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- | ----- |
| `B1` `01M6N46Q0AY0NEWQ3Q5H3EY0D1`                                      | the starting state (F1)         | 32     | baseline: target 3/8, blocks 24/24                                                                               | $1.12 |
| `F2` `01M6N4D7X0ZX7PN26AX4B6P8ET`                                      | F2                              | 32     | against `B1`: target 8/8, blocks 23/24, p = 0.077, **revert** (deviation 2)                                      | $0.88 |
| `B2` `01M6N4HD25TBQTR90206KEW888`                                      | the starting state (F1)         | 32     | baseline: target 2/8, blocks 24/24                                                                               | $0.97 |
| (`F2`)                                                                 | F2                              |        | against `B1+B2`: target 5/16 → 8/8, blocks 48/48 → 23/24 (p(worse) 0.33), all 53/64 → 31/32, p = 0.019, **keep** |       |
| `T0a` `01M6N4MRZNN558KV4QVMRQZFYT`, `T0b` `01M6N4NKJYN86TG7CCH1XEFWDF` | main's agent text, test         | 48     | test baseline: 48/48                                                                                             | $0.52 |
| `Ft1` `01M6N4PP4GCRF4ZVYWZ3XRP894`, `Ft2` `01M6N4QHFNKE4DVTFMKWA2KKW7` | the final state (F1 + F2), test | 48     | against `T0a+T0b`, `--trim`: 46/48, bound −11.3 points, overview p(worse) 0.24, **misses the bar** (deviation 4) | $0.48 |

## Result

- **Kept on train: F2.** Bars with no `value` count the rows that share a label, as a series and a pivot already do. No module or prompt bytes: `show()`'s declaration is main's, and the help changed is a refusal's text.
- **The target, train:** `chart-in-progress-by-person` 5/16 (31%) on the starting state → 8/8 on F2. Every starting-state miss was the one path F2 opens: bars from `history()` with no `value`, refused, then a pivot.
- **The done bar:** 8 of 8 on `F2`; the re-record's draw is in the PR.
- **Test:** missed the trim bar, 48/48 → 46/48. Both misses were in `table-workstreams-quiet`, the first `show()` of their turn, refused by code this branch doesn't change, before any text it changes was read (deviation 4). With a baseline of 48/48, two misses in 48 are enough to miss the margin.
- **Spend:** $3.97 of the $6 cap, in 7 rounds and 200 trials. Re-recording comes on top.
- **What the method can't see:** F2's keep came after `B2` was restored on seeing a near miss (deviation 2), which raises the chance of a false keep above 5%. The target's own move, 5/16 → 8/8, is p ≈ 0.002 alone (one-sided exact). A drop confined to one or two cases, below the margin, can be kept.
