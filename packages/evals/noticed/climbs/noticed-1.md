# Climb noticed-1: Noticed's pass, better and then faster and cheaper

The insights spike (docs/decisions/draft-noticed.md), climbed by 0031's method. This plan was committed before the climb's first counted round. `noticed-1.json` freezes the cases, their groups, k and the cap; `noticed-1.ledger.jsonl` books every round. Later changes to the plan go under Deviations.

## Goal

A pass over Oriel's signals that a person keeps: it finds the planted insights (recall), shows no decoy (precision), and every figure it shows is Oriel's (grounding), at a time to the first card and a cost that let it run after every sync. First quality, then latency and cost with no quality lost.

## Frozen

- **Cases:** 17 in `packages/evals/noticed/cases/`, on SYN's fixtures with insights planted in memory (no fixture file changes). Each plants true signals and decoys, signals that fire by Oriel's rule but whose own items explain them away (paused on purpose, re-pointed, a thank-you, a split, a misfiled move, a calibration).

  | group        | train                                     | test                                                |
  | ------------ | ----------------------------------------- | --------------------------------------------------- |
  | stalled      | `stalled-vehicles-blocked`                | `stalled-offline-waiting`                           |
  | drift        | `drift-checkout-real`                     | `drift-vehicles-real`                               |
  | overloaded   | `overloaded-amara-crunch`                 | `overloaded-esme`                                   |
  | contradicted | `contradicted-sms`                        | `contradicted-alerts`                               |
  | scope        | `scope-boarding-grew`                     | `scope-offline-grew`                                |
  | decoys       | `decoys-only`, `paused-and-broken-wallet` | `decoys-only-test`                                  |
  | mixed        | `mixed-four`                              |                                                     |
  | injection    | `injection-urgent-117`                    |                                                     |
  | big          | `big-world-vehicles` (4,000 items)        | `big-world-alerts` (4,000 items, with an injection) |

  Train is 10 cases, test 7. Test's items, texts and decoy reasons differ from train's; the kinds are the same.

- **A trial passes** when recall (every `find` signal shows), precision (no `avoid` signal shows, at most four cards) and grounding (every figure shown is Oriel's) all pass. Latency (time to the first card) and cost (tokens and dollars a run) are measured, not graded.
- **k = 6.** A run costs about a cent on Sonnet (the smoke round, below), so k is set by power, not money: the trims judge latency-motivated changes under the 8-point margin, which needs about 120 trials an arm on 10 cases.
- **Cap:** $40, live model spend, the smoke round's $0.08 outside it.
- **Method:** 0031's, `method` in `packages/evals/src/compare.ts`: a fix kept at p ≤ 0.05 on train (stratified exact test), a trim when the one-sided 95% lower bound is above −8 points, either reverted if a group is worse at p ≤ 0.10. Most groups have one train case, so a group guard is a case guard.

## Before the plan: what was run

- `oriel` (no model: Oriel's four heaviest signals): 3/17 pass. Recall 16/17, precision 3/17. Free; the floor any model has to beat.
- A smoke round, Sonnet 5.5 at medium effort on train, one trial a case: 5/10. Read for bugs in the harness, not for steering: a refused line lost its card three times (once a "3-D Secure" read as a figure, once a line past 200 characters), and a decoy stall showed because its "paused on purpose" comment is on the epic, which a stall's evidence leaves out.

## Rounds, in order

Each change is one decision, against the last kept state, judged on train only.

| step   | change                                                                                                                 | kind                               | rounds              |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------- |
| B1, B2 | start: Opus 5.5, medium effort, prompt v1, every signal, 600 characters of text                                        | baseline                           | 2 train             |
| M      | model-first: Opus 5.5 given the raw window (every item, its text, the change log) and no signals                       | reference, not a decision          | 1 train             |
| C1     | a refused line drops the line, not the pick: the card shows Oriel's headline alone                                     | fix                                | 1 train, +1 if kept |
| C2     | a stall's and a drift's items include their epics                                                                      | fix                                | 1 train, +1 if kept |
| C3     | the figure check refuses only numbers not in the signal's items' text (so "3-D Secure" passes); measured as lines kept | fix (lines kept), trim (pass rate) | 2 train             |
| T1     | Sonnet 5.5 for Opus                                                                                                    | trim                               | 2 train             |
| T2     | Haiku 5.5                                                                                                              | trim                               | 2 train             |
| T3     | effort low                                                                                                             | trim                               | 2 train             |
| T4     | only the eight heaviest signals offered                                                                                | trim                               | 2 train             |
| T5     | 300 characters of text an item                                                                                         | trim                               | 2 train             |
| P      | a prompt change, only if train transcripts show a failure the steps above left                                         | fix                                | 1–2 train           |

About 22 train rounds of 60 trials: at Opus's $0.02 a run, under $25 if every step runs on Opus; trims to smaller models cost less.

## Final

Run the start state (B's settings, before C1) on test twice, then the final state on all cases and on test once more. The bar: `compare <start on test> <final on test> --trim`. The start's test rounds are run right after B1 and B2, in the same session as the baseline, and not read until the end, because C1 and C2 change code a later session couldn't run without reverting them. Report the curve: pass, recall, precision and the first card's p50 and p90 a round, and test's start against its end.

## Deviations

- **T4 skipped.** No train case offers more than six signals, so "the eight heaviest" sends the same request as "all". The cap on signals offered is a scale decision, made on design grounds: the server offers the twelve heaviest.
- **T5 not taken, though the rule kept it.** 300 characters saved about 1% of tokens (3,000 → 2,962 a run) and no time, and lost two trials, one of them an injection showing. The trim rule can't see a saving of zero; the plan's goal can.
- **P not run.** Train was 120/120 from C2 on, with no failure left to read.
- **The model-first reference's grounding grader** first counted item keys (`SYN-104`) as figures. It was fixed to leave out IDs, keys, clock times and names with digits, and M was graded again from its transcripts, at no cost. M is a reference, not a decision.

- **After the final step, the reviews' fixes changed what the model reads.** The drift headline now reads "estimate rose on N items, from X to Y in all", a pass that ends on a tool call is a failure, and fingerprints and dismissals changed. One confirmation round of the final state on all cases (`R`, $0.39) passed 102/102, with the first card's p50 at 2.8 s and its p90 at 3.8 s. It is a check, not a decision.

## Log

| round  | change                                         | train pass                                      | first card p50 / p90          | $ a run                                    | verdict                           |
| ------ | ---------------------------------------------- | ----------------------------------------------- | ----------------------------- | ------------------------------------------ | --------------------------------- |
| oriel  | Oriel alone, no model (all 17)                 | 3/17                                            | 0                             | 0                                          | the floor                         |
| B1+B2  | start: Opus 5.5, medium                        | 74/120 62%                                      | 5.0 s / 11.7 s, 4.2 s / 7.8 s | $0.008                                     | baseline                          |
| M      | model-first, Opus 5.5, raw window              | 0/60 (recall 98%, precision 100%, grounding 0%) | 18.8 s / 27.7 s               | $0.101 ($0.56 on 4,000 items, 530k tokens) | reference                         |
| C1+C1b | a refused line keeps its pick                  | 86/120 72%                                      | 4.0 s / 7.3 s                 | $0.008                                     | fix kept, p = 0.0005              |
| C2+C2b | a stall's and a drift's items include the epic | 120/120 100%                                    | 3.9 s / 7.1 s                 | $0.008                                     | fix kept, p < 0.0001              |
| C3+C3b | a line may repeat a number its items hold      | 119/120 99%; lines kept 81% → 95%               | 4.0 s / 6.9 s                 | $0.007                                     | trim kept, ≥ −5.1                 |
| T1+T1b | Sonnet 5.5                                     | 120/120                                         | 2.9 s / 4.0 s                 | $0.003                                     | trim kept, ≥ −3.4                 |
| T2+T2b | Haiku 5.5                                      | 116/120                                         | 3.2 s / 5.5 s                 | $0.0004                                    | reverted: decoys worse, p = 0.054 |
| T3+T3b | Sonnet 5.5, effort low                         | 120/120                                         | 2.6 s / 4.1 s                 | $0.003                                     | trim kept, ≥ −4.1                 |
| T5+T5b | 300 characters a text                          | 118/120                                         | 2.8 s / 4.1 s                 | $0.003                                     | not taken (above)                 |

**Final, on test** (start = Opus 5.5 at medium with none of C1–C3; final = Sonnet 5.5 at low with C1–C3): 57/84 (68%) → 84/84 (100%), better at p < 0.0001, lower bound +26.2 points; no group worse. Recall 95% → 100%, precision 73% → 100%. First card p50 5.5 s → 2.9 s, p90 10.8 s → 3.5 s. $0.009 → $0.003 a run, about 3,100 tokens. On all 17 cases the final state passed 102/102.

**Spend:** $12.13 of the $40 cap, $6.08 of it the model-first reference.

**What the method can't see here.** Test saturated at 100%, so this suite can no longer tell good from better. Its decoys say plainly why they're harmless; a real window's won't. The next climb needs murkier decoys, windows with more than six signals, and real-shaped text.
