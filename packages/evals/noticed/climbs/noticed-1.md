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

(none yet)
