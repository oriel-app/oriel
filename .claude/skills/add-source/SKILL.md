---
name: add-source
description: Add a source to Oriel, with its adapter, fixtures and evals. Use when connecting a new external system, real or synthetic.
---

A connector is one package and one entry (decision 0049). Outside the package, besides its own fixture data and eval cases, you touch only:

- `packages/sources`: its declaration in the list in `src/index.ts`, and the package in `package.json`.
- For a writable connector, one line in `packages/changeset/src/writers.ts`, naming its `./writer` export, which builds its writer from what its declaration's `open` gave the connection.

Nothing else learns your kind's name. If something seems to need it, the declaration is missing a field: add the field, never another list.

1. In `packages/<kind>/`, hand-write the source's types and validate at the boundary with the in-house validator. No schema libraries. Implement `Source` (reads) and, for a writable source, `SourceWriter` (writes), exported only from the package's `./writer` subpath, which only `packages/changeset` may import. A read-only source has no op catalogue and no writer.
2. Declare it once, in `<kind>Declaration`, written `satisfies SourceDeclaration<…>` (`packages/core/src/declaration.ts` lists every field): its `kind` and strict `key` shape, with no text a person wrote in a key, so items read `<kind>:<key>`; how it shows; its item doc; its panel, facets, recognizer and overview candidates; for a writable source its namespace and op specs; its module `budget`; and its `fixture`. Identity is the source's stable ID.
3. Its fixture: synthetic data in `fixtures/<kind>/`, written by a generator (Jira's and Slack's are in `scripts/fixtures/`), which goes to the maintainer for review. Cover SPEC §8's mess checklist, with an injection in every free-text field. The declared `fixture` (`packages/core/src/fixture.ts`) loads it and connects to it with no network, so unit tests and evals build the same connection. It names each item a case can hold, says what a reply calls an item and how its chip reads, and leaves out anything that differs by run or disk. Fixtures from a real source server are recorded by hand with `scripts/record-source-mcp.ts` (packages/standin-mcp/README.md), never in CI.
4. Add any groupings that need the source's attributes. Mark structure the source doesn't have as `derived`.
5. Add eval cases with the add-eval skill: tombstones and injection at least. A case names your items as your fixture does (`<kind>:<name>`); nothing in `packages/evals` changes.
6. Walk CLAUDE.md's "Hit every surface" list.
