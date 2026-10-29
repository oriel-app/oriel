# 0015 Web dependencies: Preact and playwright-core

Accepted 2026-10-29.

Adds: `preact` `playwright-core`

**Decision.**

- `preact`, shipped with `packages/web`: the renderer decision 0007 chose. The server serves its ES modules (`preact`, `preact/hooks`, `preact/jsx-runtime`) at fixed paths through an import map.
- `playwright-core`, dev-only: `pnpm shots` (`scripts/shots.ts`) drives the installed Chrome (`channel: "chrome"`) and writes screenshots of the window to a gitignored `shots/`. It is a tool, not a test, and stays out of `pnpm check` and CI.

**Why.**

- Preact: see 0007. It has no dependencies.
- playwright-core: SPEC §8 asks for a screenshot script instead of a UI test suite. It is maintained, has no dependencies, downloads no browsers and is never shipped.

**Rejected.**

- `playwright` and `@playwright/test`: they add a browser downloader and a test runner we don't want.
- Our own client for the Chrome DevTools Protocol: launching Chrome on each OS, waiting for a page to settle and clicking by role are where the library earns its keep, and none of it ships.

**Consequences.**

- Preact's locked version is what the browser runs; upgrading it is a lockfile change.
- `pnpm shots` needs Chrome installed.
