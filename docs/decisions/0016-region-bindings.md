# 0016 Region bindings: declarations as text, tsc at run time

Accepted 2026-10-29.

Adds: none

**Decision.**

- `packages/bindings` emits the per-region `.d.ts` and the guest stubs as text from one description. Every ID passes core's strict key check and is written with `JSON.stringify`. No source text is emitted.
- Before each run, the host typechecks the script with the `typescript` package's own `tsc`. It runs under `process.execPath` in a fresh private temp directory, with an empty environment, `noResolve`, `types: []` and an explicit file list, and its errors are read from `--pretty false`. So `typescript` ships with Oriel, not only in development. This amends 0009 ("dev-only") and SPEC §6 ("the TypeScript compiler API").
- The script is never joined into module source. This amends 0006, which joined the script and stubs into one entry file.
  - The host strips its types with Node's `stripTypeScriptTypes`, keeping positions, and refuses the script unless it compiles as an async function body.
  - The guest's entry module is the shim alone. The shim receives the stripped body as data and builds the function with the same constructor.

**Why.**

- TypeScript 7's programmatic API is still `unstable/`, while its command line is stable. The emitter is small, and with every ID checked against a strict shape, nothing a source says can reach the declarations.
- A subprocess can be given an empty environment, so no secret reaches tsc. With `noResolve` and explicit files, tsc reads only those files and its lib, even when a script names other files. A check takes about 55 ms.
- Joined into a module, a script could close the wrapper and add a static import, which Deno loads before any permission applies. An `import` declaration can't parse inside a function body, and a dynamic `import()` meets Deno's permission check.
- Rejected: `deno check`. Deno is already required (0006), and this would keep TypeScript dev-only. But it bundles its own TypeScript and resolves a script's imports, including `import("file:…")`, so its type errors could reveal the shape of local files.
- Rejected: the unstable async API. It confines reads to a virtual file system, but it inherits the server's environment and may change.
- Rejected: the unstable sync API, because it blocks the event loop.
- Rejected: no typecheck. The agent would only learn about type errors from failed runs.

**Consequences.**

- `typescript` is a runtime dependency of `@oriel/bindings`.
- Each check briefly writes the script to a private temp directory, then removes it.
- A TypeScript upgrade must keep the `--pretty false` output format, which a test covers.
- `stripTypeScriptTypes` is still experimental in Node 26, and prints a warning once per process.
- Revisit these choices when TypeScript's API or Node's stripper is stable.
