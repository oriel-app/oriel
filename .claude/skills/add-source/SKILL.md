---
name: add-source
description: Add a source to Oriel, with its adapter, fixtures and evals. Use when connecting a new external system, real or synthetic.
---

1. Hand-write the source's types in `packages/<source>/` and validate at the boundary with the in-house validator. No schema libraries.
2. Implement `Source` (reads) and, for a writable source, `SourceWriter` (writes). Export the writer only from the package's `./writer` subpath; only `packages/changeset` may import it. The adapter owns its attrs, content shape, op catalogue, namespace and presentation; core holds only the item contract (decision 0019). A read-only source has no op catalogue and no writer. Items get source-qualified IDs (`<source>:<handle>`, like `jira:ORL-12`); add the kind and a strict key shape to core's `ids.ts`, and keep text a person wrote out of keys. Identity is the source's stable ID.
3. Write a fixture generator. Its output in `fixtures/<source>/` goes to the maintainer for review. Cover SPEC §8's mess checklist, including an injection item for every free-text field.
4. Add a fixture-backed implementation for unit tests and evals. Live adapter tests run only in the secret-gated CI job.
5. Add any groupings and zoom levels that need the source's attributes. Mark structure the source doesn't have as `derived`.
6. Add eval cases: binding correctness, tombstones, injection.
7. Walk the "Hit every surface" list in AGENTS.md.
