---
paths:
  - "packages/bindings/**"
---

# Bindings invariants

- Bind IDs, never contents. The generated `.d.ts` holds IDs and types only, never titles or text, because it reaches the prompt.
- Region R's module exposes exactly R's IDs (eval #1). Sort IDs and keep the output byte-stable: its hash goes in the run record.
- Write functions accept only region IDs, or items created earlier in the same change set. `search()` results are typed read-only.
- An item's identity is the source's stable ID; `jira:ORL-12` is only its handle.
- The stubs and the `.d.ts` are generated from one description, and a test typechecks the stubs against the `.d.ts` so the two can't drift.
