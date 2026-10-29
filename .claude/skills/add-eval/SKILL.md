---
name: add-eval
description: Add an eval case, with a golden diff where one applies. Use when a behavior needs a regression guard or a hillclimbing target.
---

- A case is one JSON file: the region (fixture IDs), the prompt, the expectation (a golden diff, zero mutations, or rubric claims) and the grader.
- Prefer a programmatic grader. Use an LLM judge only for open-ended output: write its rubric as checkable claims, not a scale, and use a judge model different from the model under test.
- Golden diffs go in `tests/golden/`, which the maintainer owns. Propose them; don't edit.
- Record the cassette with `pnpm evals` against the live model. CI replays it.
- Put the case in the train or the test split. Never tune against test.
