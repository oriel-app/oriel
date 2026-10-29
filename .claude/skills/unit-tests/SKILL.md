---
name: unit-tests
description: What makes tests here slow or flaky, and how to write ones that aren't. Use when writing, fixing or reviewing tests.
---

- `node:test` and `node:assert` only. One package: `pnpm --filter <pkg> test`.
- No sleeps and no timeouts. Await the event or promise; a test that needs a timeout to pass is wrong.
- Pass time in (`now`). Code under test never reads the clock.
- Fixtures over mocks. Model calls replay cassettes; unit tests never touch the network.
- Each test owns its data (a fresh schema or temp dir) and never depends on run order.
- No UI tests. For visuals, use the screenshot script.
- Tests that define behavior aren't edited in the PR they validate.
