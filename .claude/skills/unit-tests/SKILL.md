---
name: unit-tests
description: Which layer a change gets a test at (unit, flow, upgrade, live or none), which unit tests earn their place, and what makes tests here slow or flaky. Use when writing, fixing, deleting or reviewing tests, at any layer.
---

## Which layer

Pick the lowest layer that would have caught the bug a person would hit. Most changes need one test or none.

- **Unit:** only for the keep rule's classes below. Not for routes, wording, labels or happy paths.
- **Flow:** anything a person does across pages: the first run, Needs you, pills, scroll, a thread's states. A shots scene that asserts as well as shoots, or a design-system page.
- **Upgrade:** a migration or a stored shape. A database copied from the last release, run through the new code.
- **Live:** agent-facing text (the system prompt, the module, tools, a tool result). An eval recording.
- **None:** copy, layout and one-line UI changes. The shots and `ui-check` cover them.

A change that crosses pages and touches stored data gets both a flow and an upgrade check, not five unit tests. When a bug reaches main, add the one test at the layer that would have caught it.

## The keep rule

A unit test stays only if it guards one of these. Name the class in review.

1. **Trust boundary:** the sandbox and bindings; the permission and replay guards in packages/agent/src/server-calls.ts; secrets never logged, printed or sent; source content kept out of prompts and `.d.ts` files; the review link; only a person approves.
2. **Data a person can lose:** change-set apply, revert and Undo; migrations run on data; sync identity (IDs that survive a re-sync or a move); connection secrets moving and being deleted; workstreams, threads or unsent messages lost on failure, retry, races or Undo.
3. **Untrusted input rejected** where it prevents unauthorized access, unsafe writes, data corruption or resource exhaustion. Parsing or formatting alone does not qualify.
4. **A defect seen before:** pure logic reproducing an observed defect. Cite the fixing PR or commit and the wrong result. One test per failure.
5. **A budget the product depends on:** the module and prompt byte budgets, one test each.

A test goes if it pins wording, a label or a list that grows with every kind; restates the implementation or tests a mock; duplicates another test or another layer's check (types, `ui-check`, `ds:check`, `check-repo`, evals, shots); or would only ever be edited because behaviour changed on purpose. A kept test asserts behaviour or shape (a status, an error code, which item, that a value is absent), never Oriel's wording; exact wording lives on design-system pages.

## Writing them

- `node:test` and `node:assert` only. One package: `pnpm --filter <pkg> test`.
- No sleeps and no timeouts. Await the event or promise; a test that needs a timeout to pass is wrong.
- Pass time in (`now`). Code under test never reads the clock.
- Fixtures over mocks. Model calls replay cassettes; unit tests never touch the network.
- Each test owns its data (a fresh schema or temp dir) and never depends on run order.
- No UI unit tests. For visuals, use the screenshot script.
- Tests that define behavior aren't edited in the PR they validate.
- A guard's test should fail when the guarded line breaks: break it once by hand before you commit.
