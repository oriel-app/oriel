---
name: add-adr
description: Record an architecture decision in docs/decisions/. Use when choosing between options, adding a dependency, or changing anything SPEC.md decides.
---

- Number it with `pnpm -s github next-decision` (from a worktree, run the main checkout's `scripts/github.ts`). It prints the next number free on main and in every open PR, so two drafts can't clash; `node scripts/check-repo.ts` fails if two do. Name the file `docs/decisions/NNNN-short-title.md`.
- Sections: Decision, Why, Rejected (if any), Consequences. Keep it short.
- A dependency ADR has an `Adds:` line listing, in backticks, every package it brings in, transitives included (`@scope/*` globs are allowed). Mentions anywhere else in the ADR don't count. The same entries go on the AGENTS.md allowlist. `node scripts/check-repo.ts` enforces both.
- If it changes SPEC.md, update SPEC.md in the same PR.
- `docs/decisions/` is the maintainer's. An ADR is a proposal: draft it, and the edit asks for the maintainer's approval. It is accepted only when they approve it.
