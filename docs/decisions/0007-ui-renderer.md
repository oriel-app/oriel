# 0007 UI renderer: Preact, compiled by tsc

Accepted 2026-10-28.

**Decision.** `preact`, with JSX compiled by `tsc` itself (`jsx: react-jsx`, `jsxImportSource: preact`) and served as native ES modules through an import map. Hooks only; no signals, no compat layer. It lands with `packages/web`.

**Why.** About 4 KB with zero dependencies, and maintained. `tsc` already does the JSX transform, so there is no Babel and no bundler. `tsc` type-checks JSX props, which it can't do for template-literal renderers without a plugin.

**TanStack.** We use its framework-independent `*-core` packages only when a need is measured, each with its own ADR. Phase 1 is one page with about five routes and our own `Grouping`, so a router or table core would sit unused. The likely first need is `virtual-core`, if a real pilot's list scrolls badly.

**Rejected.**

- Lit: similar size, but plain `tsc` doesn't type-check its templates.
- Solid: its JSX needs Babel, which means a bundler.
- React: roughly ten times the size.
- Svelte and Vue: need compilers.
- Plain DOM: we would end up writing a reconciler for the diff and inbox.

**Consequences.** The server serves Preact's ESM files at pinned paths. The phase 2 canvas mounts through a ref and never imports Preact.
