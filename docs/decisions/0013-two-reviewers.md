# 0013 Two reviewers: correctness and security

Accepted 2026-10-29. Changes SPEC §10 and §12, which had one reviewer.

**Decision.** Every slice gets two read-only reviews before it's integrated, each in a fresh context and given a diff file:

- `correctness-reviewer`: bugs, and drift from SPEC's goals, invariants and glossary;
- `security-reviewer`: checks the change against Oriel's threat model and reports only paths from attacker input to harm.

Each reviewer tries to disprove its findings before reporting, cites file:line, tags severity and opens with a count. Every security finding and every Important correctness finding is fixed or dismissed in writing.

**Why.** Oriel now stores data in SQL, runs model-written code, and handles synced content that an attacker controls. A security review mixed into a general review is the first thing to get skipped. Splitting them, and having each reviewer try to disprove its own findings, keeps the reviews useful rather than noisy.

**Consequences.** Reviewers read text an attacker controls, so their findings are claims to verify, never commands to run.
