# 0057 The design system in the repo

Proposed 2026-11-04, from the maintainer's "once the design comes back we can move forward with the migration to this repo". Amends SPEC §14, which listed a design system as not now.

Adds: none

**Decision.**

- **The design system lives in the repo,** as `packages/design-system` (`@oriel/design-system`, private). It is Oriel's component workshop: guide pages for its foundations, components, patterns and screens, with specimens drawn by the window's own `window.css`, read live; the drift and controls reports; and checks that judge the window against the guide. `pnpm design` serves it on 127.0.0.1:4400. It came from a local repo at `33f141f`, without its history. Its screenshots stay out of git.
- **`pnpm check` runs its fast checks,** the ones that need no browser, in about 1.5 s: the guide's own (sections, statuses, specimen ids, COMPONENTS.md current), and those that judge the window: every class a page documents or a specimen uses is in `window.css`; every class `window.css` styles and every component `packages/web/src` exports is on a page or in UNDOCUMENTED.md; every name a page cites is in its file; proposals use only tokens; and every claimed contrast pair passes, by the window's own theme code. Its typecheck and unit tests run there too, and the repo's lint and format rules cover it.
- **`pnpm ui-check` adds the three in headless Chrome,** in about 45 s: the accessibility pass (every control in every specimen, in Graphite light and Broadsheet dark, has a name and shows focus), every link and anchor on every page, and the workshop's own chrome. Builders run it when they touch `packages/web`, and fix the page it names in the same PR. CI runs it when `packages/web/**` or `packages/design-system/**` changes, once the maintainer adds the step.
- **Names, not lines.** A page cites the window by name: a selector, at-rule or token in `window.css`, a top-level declaration in a source file, as "`name` in `file`", with a count where it is written more than once. The check fails on a name that isn't there, a wrong count, or any `file:line`. `pnpm -s ds where <name>` prints the line it is on today.
- **UNDOCUMENTED.md is the to-do.** What no page covers yet is listed there with a reason, so a new surface fails the check until someone documents it or lists it on purpose, and a line fails once a page covers it or the window drops it. A family entry such as `.noticed-*` covers `.noticed` and every `.noticed-…` class, including ones added later without a word on any page. Where a new class matters on its own, list it by its exact name.
- **The workshop's server shows only what git would.** `/source/<file>` serves a file inside the checkout, once its links are followed, that git tracks or would track, so nothing it ignores (`.env`, `secrets/`, `.oriel/`) is ever served. `?at=<commit>` takes only a hex commit and a plain relative path. It answers only a request addressed to 127.0.0.1 or localhost.

**Why.**

- Outside the repo, a builder who renamed a class couldn't fix the page that cites it in their own PR, and CI never ran its checks, so the guide went stale silently. Names going stale is the whole risk, and every builder runs `pnpm check`, so the name checks go there; they cost about 1.5 s.
- The accessibility pass costs about 30 s and needs Chrome, so it waits for builders who touch the window, and for CI.
- Citing lines broke on every edit above them: about 1,400 citations, checked only for being inside their file.

**Rejected.**

- **All of it in `pnpm check`.** The browser checks would add about 45 s to every builder's check, most of whom never touch the window.
- **Rendering the window's own Preact components as specimens.** It needs a build and the app's contexts around each component, and can't show several hand-copied versions of one control side by side, which is what the drift report is about.

**Consequences.**

- A PR that changes `window.css` or `packages/web/src` and breaks a name fails `pnpm check`, and fixes the page in the same PR.
- `pnpm check` runs a little over 1.5 s longer.
- The guide's pages, the reports and UNDOCUMENTED.md moved as they were; documenting what it lists is the next story's.
