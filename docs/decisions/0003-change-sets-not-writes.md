# 0003 Change sets, not writes

Accepted 2026-10-28.

**Decision.** Agent code never writes to a source. Writes made in the sandbox are captured as mutations in a change set. A person approves it, in the thread or through its review link, and only then is it replayed. Replay sends exactly the captured arguments, never re-derived ones. Applied change sets keep their reverse diff and can be reverted; a revert is itself a change set.

**Why.** It is what lets a PM trust the agent, and the review link is how Oriel reaches people who aren't in it.

**Consequences.** Enforced in three layers, each tested:

- Types: `SourceWriter.apply` takes only `Approved<…>`, and nothing outside `packages/changeset` may cast to it.
- Runtime: before every write, the writer re-reads the approval and checks the change set's hash, so editing after approval voids it.
- Process: the sandbox has no network. Its only channel is the host, which captures writes.

Each mutation records its status and the source's external ID as soon as the source answers, so a retried replay skips what landed. A revert stops on any field the source changed since apply.
