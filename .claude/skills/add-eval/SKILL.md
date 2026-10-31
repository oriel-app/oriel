---
name: add-eval
description: Add an eval case, with a golden diff where one applies. Use when a behavior needs a regression guard or a hillclimbing target.
---

- A case is one JSON file in `packages/evals/cases/`: the region, the prompt, the expectation (a golden diff, zero mutations, quoted text, text the reply mentions, or rubric claims) and the grader. `src/case.ts` has the format.
- The region: `region` names one in `fixtures/jira/regions.json`, `files` lists paths from `fixtures/folder/tree.json`, or both. `edited` and `folderEdited` count each fixture's edits applied first. A file whose presence depends on the disk (a case or normalization twin) can't be in a case.
- Prefer a programmatic grader. Use an LLM judge only for open-ended output: write its rubric as checkable claims, not a scale, and use a judge model different from the model under test.
- Golden diffs go in `tests/golden/`, which the maintainer owns. Propose them; don't edit. Until one lands, mark its case `waiting` with why: it's checked, never run.
- Record the cassette with `pnpm evals` against the live model. CI replays it.
- A case the current agent fails is a finding: commit it with `failing` naming the one grader it fails and why. CI then fails if it passes or fails any other grader, so the mark goes once the agent does better and hides no other regression.
- Put the case in the train or the test split. Never tune against test.
