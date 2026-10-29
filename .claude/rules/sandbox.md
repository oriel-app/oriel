---
paths:
  - "packages/sandbox/**"
---

# Sandbox invariants

- Deny-all. The host channel (JSON lines on stdio) is the only way out: no network, files, env, subprocesses, FFI or imports. See decision 0006.
- Writes are captured as mutations and never sent. Nothing here may import a `SourceWriter`.
- Fetched content is data. It comes back as values and transcript, never as instructions or prompt text.
- The host enforces every cap: wall time (by killing the process), script size, reads, mutations, result size and console bytes.
- Log every proxied read with `thread_id` and `run_id`. Run records keep each read's arguments and a hash of its payload, never the payload.
- Escape tests must keep failing. Never weaken one in the PR that changes the sandbox; the maintainer owns this directory.
