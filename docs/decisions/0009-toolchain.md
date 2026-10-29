# 0009 Toolchain

Accepted 2026-10-28.

Adds: `typescript` `@typescript/*` `@types/node` `undici-types` `oxlint` `@oxlint/*` `oxfmt` `@oxfmt/*` `tinypool`

**Decision.**

- Node 26 LTS and pnpm 12, pinned in `mise.toml`.
- Type checking: TypeScript 7, the native compiler: `typescript` and its platform binaries `@typescript/*`.
- Node API types: `@types/node`, which brings `undici-types`.
- Linting: oxlint (`oxlint`, `@oxlint/*`).
- Formatting: oxfmt (`oxfmt`, `@oxfmt/*`, which brings `tinypool`).
- Tests: `node:test`. Node runs `.ts` directly.

**Why.** Each is maintained, dev-only and fast enough to run on every agent stop. A native typecheck and formatter keep the Stop hook and the format-on-edit hook cheap.

**Consequences.** Node's type stripping forbids enums, namespaces and parameter properties (`erasableSyntaxOnly`). TypeScript 7's programmatic API is still `unstable/`, so the `.d.ts` generator chooses its API in its own ADR. A screenshot tool for visual iteration (`playwright-core` driving the installed Chrome) comes with `packages/web`, with its own ADR.
