# 0008 Dependency policy

Accepted 2026-10-28.

**Decision.** We build it ourselves unless it is security-critical (sandboxing, crypto, TLS), a protocol standard we must interoperate with, or a database driver. Dev-only tooling is allowed if maintained and not shipped; platform built-ins come first. No unmaintained packages, ever.

**Why.** Agents maintain this repo around the clock. Every dependency is code they can't fully read and a supply chain they can't audit.

**Enforcement.**

- Every package in `pnpm-lock.yaml`, transitive included, must come from the npm registry, match an entry on the AGENTS.md allowlist, and appear on an ADR's `Adds:` line. Mentioning a package elsewhere in an ADR, for example as rejected, doesn't count. `scripts/check-repo.ts` checks all of this in `pnpm check` and in CI. ADRs and AGENTS.md are maintainer-owned.
- pnpm refuses versions younger than 7 days (`minimumReleaseAge`) and runs no install scripts.
- GitHub Actions are pinned by commit hash.
