# 0017 Sandbox host: what 0006's flags don't cover

Accepted 2026-10-29.

Adds: none

**Decision.** `packages/sandbox` runs each script as 0006 says (a fresh `deno run` with every permission denied), with these additions, each tested against the real Deno pinned in `mise.toml`:

- **Script as data.** The script never becomes module source (0016).
- **Import map.** It sends every `file:` specifier other than the entry's to a scheme Deno refuses. This is a second line of defence: with the script as data, only the runtime and the shim could import anything.
- **No update check.** `DENO_NO_UPDATE_CHECK=1` is set in the otherwise empty environment, because without it the CLI fetches its update check itself.
- **Memory.** An RSS watchdog kills a run over its memory cap, because V8's heap cap doesn't count ArrayBuffers. It samples every 50 ms, so it can overshoot by one interval's allocation.
- **Disk.** `DENO_DIR/location_data` is read-only, because the Cache API writes there despite `--deny-write`.
- **Deadline.** This replaces 0006's in-guest deadline. When the host kills a run at its wall-time cap, it returns a clean error with phase `limit`, naming the cap.
- **Root.** The host refuses to run as root, where file modes don't hold.
- **Isolation of the type stripper.** `typecheck` and `guestStart` run in a worker that is replaced after any failure. A hostile script, such as a long chain of arrow functions, can break Node's type stripper for the rest of its thread. `guestStart`'s bounds on size and nesting catch some such scripts, but not all.

**Why.** Each one closes a gap found by a test:

- A static import of a local file loads despite `--deny-read`, and so do a JSON import and a literal `import()` in module source. Only an `import()` inside a function body meets the permission check.
- A guest allocated 4 GB under a 64 MB heap cap.
- The Cache API wrote 128 MB with writes denied.

**Consequences.**

- The cold start, from spawn to the guest's first line, takes about 19 ms on the maintainer's Mac. A whole run with one read and one write takes about 86 ms, most of it the typecheck. Each run reports its cold start.
- Upgrading Deno means re-running `deno.test.ts`, which pins what each specifier form does.
- Running as root is unsupported.
