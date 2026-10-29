# 0012 Agent merges need the maintainer's go-ahead

Accepted 2026-10-29. Changes SPEC §10, which said "No agent merges".

**Decision.** An agent merges only with the maintainer's explicit go-ahead for that work, and only through branch protection as configured. Required CI and the merge queue are never bypassed. The go-ahead covers the changes it was given for. If a later push touches a code-owned path (`tests/`, `fixtures/`, `.github/`, `packages/sandbox/`, `docs/decisions/`), the agent needs a fresh go-ahead.

**Why.** Agents push as the maintainer, so GitHub can't tell their merges from the maintainer's. A flat "never" left every PR waiting on the maintainer, even after they had said to ship it.

**Consequences.** An agent merges its own PRs through the review rule's admin bypass. The required `check` and the merge queue still gate every merge.
