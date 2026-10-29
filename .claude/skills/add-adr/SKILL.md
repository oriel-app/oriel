---
name: add-adr
description: Record an architecture decision in docs/decisions/. Use when choosing between options, adding a dependency, or changing anything SPEC.md decides.
---

- Next number: `docs/decisions/NNNN-short-title.md`. Sections: Decision, Why, Rejected (if any), Consequences. Keep it short.
- A dependency ADR names, in backticks, every package it brings in, including transitives (`@scope/*` globs are allowed). The same entries go on the AGENTS.md allowlist. `node scripts/check-repo.ts` enforces both.
- If it changes SPEC.md, update SPEC.md in the same PR.
- `docs/decisions/` is the maintainer's. Draft the file; the edit asks for approval.
