# 0002 TypeScript, not Rust (phase 1)

Accepted 2026-10-28.

**Decision.** Server, UI and tooling are TypeScript on Node in phase 1.

**Why.** One language for the server, the UI and the code the agent writes against generated `.d.ts` files. Node runs TypeScript without a build step. Before pilots, iteration speed matters more than raw performance.

**Consequences.** A component moves to Rust only when a measurement or a dead dependency forces it (SPEC §6), each with its own ADR.
