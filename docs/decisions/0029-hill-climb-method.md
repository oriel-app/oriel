# 0029 Hill-climbs run to a frozen plan, with repeats and a held-out test

Accepted 2026-11-02 (OA-144, OA-54). Changes SPEC §8's hill-climb rule.

Adds: none

**Decision.**

- **A climb is frozen before its first live round.**
  - `pnpm evals freeze <name>` writes `packages/evals/climbs/<name>.json`, holding each case's hash and group, the runs a case and a dollar cap.
  - `<name>.md` beside it holds the plan: goal, cases, settings, rounds and money, the changes to try in order, the final step, and deviations.
  - The CLI refuses a climb's round if a case changed since the freeze, or if the round's estimate would pass the cap. It books every round's cost in `<name>.ledger.jsonl`.
- **Each case runs k times a round.** Comparisons use every run.
- **Two comparisons.** Settings live in `method`, `packages/evals/src/compare.ts`.
  - A **fix** is kept when train is better beyond noise. The test is the exact test stratified by case: given each case's passes over both arms, the candidate's share is hypergeometric, and the case results are convolved; one-sided, p ≤ 0.05. With one run a case in each arm it is the sign test, the rule before this one.
  - A **trim** is kept when train is no worse within 8 points. The one-sided 95% Newcombe lower bound on the pass-rate difference must be above −0.08.
  - Either is reverted when any group of cases is worse: the stratified test for "worse" within the group, p ≤ 0.10.
- **Iterate on train only.** Test runs at the end, the starting state and the final one in one session. Its bar is the trim rule. A failure seen only in test becomes a new train case, never a change.
- **A/A check.** `pnpm evals aa <rounds>` judges every split of one state's runs against itself, both ways, and counts false keeps, false reverts and false guards.

**Why.**

The first OA-144 climb (PR #105) reached a real result but couldn't be trusted:

- It steered on test, because the rule kept a change only if both splits improved.
- It changed cases after their baseline.
- It took one sample per case, though some cases flip about one run in seven.
- It judged trims by eye, because "improves beyond noise" can't pass a trim. A trim it kept broke file naming in about 30% of runs.
- It had no cost cap: 32 rounds, about $20.

Repeats make a single case's flip visible. The stratified test uses them without assuming cases are alike. A non-inferiority bound gives trims a bar of their own. The freeze, the ledger and the cap make the plan the thing that runs.

**Rejected.**

- **A sign-flip test over cases' rate differences.** It can't reach p ≤ 0.10 for a group of three cases, whatever their runs show.
- **An odds-ratio bound for trims.** When every run passes in both arms it has no information, so it would refuse a perfect trim.
- **A second runner or a hosted eval tool.** `packages/evals` is the harness.

**Consequences.**

- A climb costs more per round and less per decision. A fix decision is one round of k runs a case against the last kept state; a trim is two rounds against two.
- The new rule has a blind spot: a drop confined to one or two cases, below the 8-point margin, can be kept.
- `compareRounds`, the old rule, is gone. Its four tests are rewritten for `compareChange` (SPEC §11).
