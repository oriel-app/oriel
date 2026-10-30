# 0006 Sandbox runtime: Deno as a subprocess

Accepted 2026-10-28.

**Decision.** Each run is a fresh `deno run` process at a pinned Deno 2 version, in `mise.toml` once `packages/sandbox` lands.

- Permissions: no `--allow-*` flags, plus `--no-prompt --no-remote --no-npm --no-config` and explicit `--deny-*` for net, read, write, env, run, ffi, sys and import.
- Environment: empty env except `DENO_DIR`, an empty temporary working directory, a capped V8 heap.
- ~~The agent's script and the generated binding stubs are joined into one entry file.~~ Amended by 0016: the entry file is the binding shim alone. The script arrives as data and runs as an async function body, never as module source.
- The guest talks to the host only through JSON lines over stdin/stdout. Reads come back as values; writes are queued as captured mutations, never awaited as effects.
- Deadlines: ~~an in-guest deadline gives a clean error, and~~ the host kills the process at the hard wall-time cap. Amended by 0017: the host's kill returns the clean error. The host also caps script size, reads, mutations, result size and console bytes. 0017 adds further hardening that these flags don't cover.
- Errors come back as `{ phase, message, hint, logs }` with phase one of typecheck, runtime or limit, so the agent can fix its own script.

**Why.** It runs TypeScript directly, so it doesn't depend on a TypeScript transpiler API. Deny-all is its default, and its permission model is built for untrusted code. A separate process gives a hard kill and a reliable memory cap. There is no npm dependency, and the Deno team ships security releases.

**Rejected.**

- QuickJS-ng compiled to WebAssembly, through quickjs-emscripten. It is in-process with a strong WASM boundary and fast pooled starts, but:
  - it is a library dependency;
  - QuickJS's own memory limit doesn't bound emscripten builds, so the real cap must come from `WebAssembly.Memory`'s maximum, which needs care with private internals;
  - it needs a TypeScript transpiler.

  It is the fallback if Deno misses the latency eval: use `quickjs-emscripten-core` and a quickjs-ng sync WASM build directly (not a wrapper with a filesystem shim), with Node's built-in `stripTypeScriptTypes`.

- `node:vm`: Node's own docs say it is not a security mechanism.
- Node's `--permission`: documented as a seat belt for trusted code.
- `isolated-vm`: a native-addon library.
- workerd: viable but heavier to configure.
- Rust with `deno_core`: contradicts 0002.

**Consequences.**

- Deno is a system prerequisite (mise locally, mise-action in CI, the image when hosted).
- Each run pays a cold start; it is measured under eval #6, and a warm pool is added only if the numbers demand it.
- Remaining risk: a Deno or V8 permission bypass. OS-level confinement (sandbox-exec, Landlock, bubblewrap) comes when we host.
- Escape tests live in `packages/sandbox`: network, file read, env, subprocess, FFI, dynamic `import()` of `file:` and `https:`, `Function`-constructor tricks, and an infinite loop must all fail.
