# 0011 Storage: Node's built-in SQLite

Accepted 2026-10-29. Changes SPEC §6, which allowed a Postgres driver.

**Decision.** Store everything in `node:sqlite`, Node 26's built-in SQLite: one database file per instance, in WAL mode with foreign keys on.

- Numbered SQL migrations in `packages/db/migrations/`, applied by our own runner. It refuses to start if an applied file was edited or the database is ahead of the code.
- STRICT tables, JSON columns checked with `json_valid`, and times stored as canonical instants (text that sorts).
- `search()` matches folded substrings in code rather than using SQLite's full-text index, whose tokenizer can't split Japanese titles.

**Why.**

- No dependency at all. SPEC §6 prefers platform built-ins even over an allowed driver; `pg` would bring six packages.
- No database server to install or run: not locally, not in CI, not on a pilot's single-workspace instance.
- Each test opens its own in-memory database, so tests are hermetic and fast.
- It fits phase 2's local-first client layer.

**Rejected.** Postgres, with `pg` or `postgres`. It is the better multi-tenant server, but there is one workspace per instance, and it needs a running server everywhere.

**Consequences.**

- One writer at a time. That is fine for a single-workspace instance, with WAL and a busy timeout.
- `node:sqlite` is a release candidate in Node 26. If its API changes, the change stays inside `packages/db`.
- If multi-tenant hosting arrives, Postgres comes back with its own ADR. Keep SQL plain; SQLite-specific bits (STRICT, `json_valid`) stay in `packages/db`.
- Hosted pilots back up with `VACUUM INTO` onto the volume once hosting lands.
