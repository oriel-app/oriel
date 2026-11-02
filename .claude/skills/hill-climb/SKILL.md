---
name: hill-climb
description: Improve the agent's prompt, module or tool results against the eval suite, with repeats, a frozen plan, a cost cap and a held-out test split. Use for any story that changes agent text to move an eval, or trims it under a budget.
---

The harness is `packages/evals`; there is no other runner or grader. Live rounds cost money, so plan first and spend to the plan.

**Before any live round**

- Read the cases you will climb on against their fixtures. For each one, ask: does answering it require reading the field that holds what the grader checks? Fix or drop a case now, never after its baseline.
- Balance the suite by group (`injection`, `oriel`, `scope` and so on). Every behaviour a change could break needs a train case, or the break shows only in test, where you may not act on it. Add a case only from a real failure or from the climb's own target (the add-eval skill). Split it before its baseline.
- Freeze the climb: `pnpm evals freeze <name> --cap <dollars> --reps <k>`. This writes `packages/evals/climbs/<name>.json`, holding each case's hash and the cap. Set each case's `group` in that file by hand.
- Write `climbs/<name>.md` with:
  - the goal and the frozen cases by group;
  - k and why;
  - the method's settings (`method` in `src/compare.ts`);
  - rounds and dollars planned;
  - the changes to try, in order, each marked fix or trim;
  - the final test step;
  - an empty Deviations section.
- Commit and push both before the first round. Later changes go under Deviations, with why.
- **Choosing k:** simulate the train suite at the flake rates you know, from earlier rounds or ledgers. Take the smallest k at which:
  - an A/A comparison keeps a fix under 5% of the time;
  - the fix you expect is found;
  - most neutral trims are kept.

  Past that, more runs don't help: a guard on a group of a few cases is limited by its cases. On the oa-144 suite this gave k = 4.

**Rounds**

- `pnpm evals --env <main checkout>/.env --climb <name> --label "<what changed>"` runs train, k runs a case.
  - The CLI refuses to run if a case changed since the freeze, or if the round's estimate would pass the cap.
  - It books the round's cost in `climbs/<name>.ledger.jsonl`. Commit the ledger as it grows.
- `--split test` and `--split all` are for the final step only.
- Check the change applied (`git diff`) before you spend a round on it.

**Deciding**

- One change per decision.
- **A fix** is meant to make something pass. `pnpm evals compare <baseline> <candidate>` keeps it only when:
  - train is better beyond noise: the stratified exact test, p ≤ 0.05;
  - no group is worse: the same test within the group, p ≤ 0.10.
- **A trim** isn't meant to improve anything. `compare … --trim` keeps it when the one-sided 95% lower bound on the pass-rate difference is above −8 points, and no group is worse. Judge a trim on two rounds of its own against two of the baseline: `compare a+b c+d --trim`.
- **Baselines:**
  - The baseline is the last kept state's rounds, pooled with `+`.
  - After a kept fix, run one more round of it, so later trims have 2k runs a case to compare with.
  - `pnpm evals aa <round>+<round>` on two rounds of one state is a free A/A check.
- **Reading transcripts:** read train transcripts only (`.evals/<round>/transcripts/`: a case's first run is `<case>.json`, its later ones `<case>.rep<n>.json`), to find the behaviour behind a failure. A fix must come from train evidence. If only test shows a failure, write a train case that reproduces it, before its baseline.
- **Prefer structural changes.** Moving a rule to where the agent meets it (a run's result, a type's doc, a refusal from Oriel) beats rewording a sentence. Rewording is brittle, and a module trim can move behaviour far from the words cut.

**Final**

- Run the starting state on test (`--split test`), then the final state on all cases (`--split all`), in one session. The final round's first run of each case records the cassettes.
- **The bar:** `compare <test baseline> <final> --trim` on test. The headline is the target group's test rate before and after, with intervals and p.
- Test runs once. If it misses the bar, report it; don't tune on it.
- `pnpm -s --filter @oriel/evals evals:ci` must exit 0. Remove a `failing` mark that now passes, and say so.

**Report**

Put this in the PR:

- the plan file;
- the log: each change, its rounds, the verdict and its cost, from the ledger;
- every deviation;
- spend against the cap.

Name what the method can't see: a drop confined to one or two cases, below the margin, can be kept.
