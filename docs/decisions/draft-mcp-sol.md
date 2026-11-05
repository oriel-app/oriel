# Draft: programs need conditional commands and receipts

Spike `mcp-sol`, based on `mcp-door`. Proposal for the maintainer, not an approved decision. Adds: none.

## Recommendation

Keep the separate authenticated loopback door. Make its actions a command protocol with explicit preconditions and recoverable outcomes. The window, the agent and outside programs should call the same dispatcher; transport details should not decide whether stale work commits.

A token and a JSON Schema do not make an action safe to retry. An HTTP connection can disappear after Oriel changed its data. A coding agent can read a workstream, spend minutes working, then act after the user changed it. These are ordinary program behavior, not speculative concurrency.

## Built

Two tools, using the existing door and existing membership actions:

- `workstream_checkpoint(workstream)` returns the region version, members and server epoch, labelled as data. It is a tool because the original spike found clients that never discover resources.
- `workstream_edit(workstream, operation, items, expectedVersion, requestId, epoch)` adds or removes members. Its receipt records `applied`, `refused`, or `uncertain`. The resulting region version is captured in the synchronous mutation handler, not read later when another action may already have committed.

The dispatcher checks the condition on entry and again immediately before the store mutation, after asynchronous preparation. Two commands prepared on the same region cannot both commit. The condition accepts only the two membership actions and their named workstream. Existing action validation, attribution, Undo, telemetry and publishing run unchanged through the dispatcher. No action reaches a source writer or decides a change set.

The command ledger is keyed by connected-tool ID and request ID. It reserves a promise before execution, so simultaneous retries share the same execution. Identical retries return the original receipt; different arguments under an existing ID are refused. A retry after the user uses Undo returns the historical receipt and does not repeat the action. An unexpected failure is kept as `uncertain`; it is never retried automatically.

## Deliberate spike limits

The ledger is in memory, capped at 512 commands across tools. It refuses new commands at capacity and retains old receipts. It never evicts a key and silently enables replay. A server restart changes the epoch; old commands are refused before execution. This is safe refusal across restart, not durable exactly-once execution. The caller must inspect the workstream to resolve an uncertain outcome, not fetch a new epoch and blindly resubmit.

Old unguarded tools remain for comparison. This branch does not claim the whole door is now retry safe. Production should put command identity and conditions into the shared action envelope, generate its schemas from one declaration, and persist the receipt in the same SQLite transaction as the data change. Do not ship parallel handwritten command definitions as the permanent architecture.

The new tools do not start a model or change the window's layout. They use the membership history and Undo already implemented by `mcp-door`. No dependency, source connection, credential store, fixture, golden file or existing decision changed.

## Real program evidence

Run `node scripts/mcp-command-try.ts`. It starts a fresh SYN fixture server on two automatically allocated loopback ports, calls the door over HTTP as Repository bot, checks the window's workstream view, uses its Undo as the user, and closes both listeners. It prints no token. It exercises the legacy 2025-06-18 wire path; modern framing is covered by the existing handler fixture tests.

Observed transcript, identifiers shortened here:

```text
checkpoint                         region 1
edit remove SYN-10, request one     applied, region 2
simultaneous identical retry        applied, region 2 (same receipt)
window history                     Repository bot; removed SYN-10; Undo workstream.add
edit another member, expected 1     refused, conflict: current 2
user Undo                          SYN-10 restored
retry request one                  original region-2 receipt; SYN-10 stays restored
reuse request one to add            refused: different command
retry from previous epoch          refused: inspect before resubmitting
```

One local sample: checkpoint 12.72 ms, concurrent edit and retry 3.21/3.18 ms, stale refusal 1.03 ms, retry after Undo 1.03 ms. These are fixture measurements, not a latency budget or a benchmark. Model spend: $0. No live client model was run; this is a deterministic HTTP program, not a claim about model tool selection.

29 targeted tests passed. They cover simultaneous retries, stale regions, a window edit during asynchronous preparation, competing removals, Undo followed by retry, key reuse, distinct connected tools, read-only access, revocation, old epochs, full-ledger refusal and ambiguous failures. Existing approval-exclusion tests remain in place.

The thread agent's system prompt is 2,400 bytes, the run tool's own description 476, and the base region module 4,668 by the repository's measurement. Their inputs did not change: byte delta 0 for each. This changes the external MCP catalogue, not the thread agent's module or prompt.

## Critique of mcp-door, ranked

1. **Shipping blocker: attribution and Undo are promised more broadly than implemented.** Rename becomes the person's own name; create, rename, mark done and reopen lack the promised visible Undo. Restrict acting capabilities until every offered action meets the invariant. Keep membership actions as the initial slice.
2. **Programs cannot recover a lost answer.** Retrying `thread.open` can create another thread, and retrying `thread.say` can hold the same words twice. JSON-RPC request IDs correlate answers; the draft has no application receipt ledger. This spike proves the missing command mechanism on membership; extend it before broad acting access.
3. **Reads have versions but writes do not state what they read.** A delayed program can change the user's newer region. Guard inside the shared dispatcher, not in a transport wrapper.
4. **Read only is still workspace-wide disclosure.** It is safe from source writes, not a narrow integration grant. A repository bot usually needs one workstream, not every connected source and thread. Recommend a later workstream-limited grant with explicit rules for membership expansion, search and thread reads. This spike does not implement it.
5. **Held words are a useful gate, but not structured proposals.** Requiring Oriel's agent to interpret an outside program's proposed update spends another turn and loses exact field intent. Investigate typed captured proposals into a thread's change-set diff, with the same person-only approval gate, separately from trusted autonomous turns.

## Keep, change, add

Keep token-bound identity, separate listener, Host/Origin refusal, read-only mode, registry-generated actions, data labels and the person-only source-write gate. Keep resources and subscriptions as optional conveniences; new clients must be useful with tools alone. The draft's modern transport changes agree with the official MCP changelog: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx.

Change the unit of program interaction from an unconditioned function call to a conditional command with a receipt. Add a checkpoint tool now, durable receipts before production retries, and scoped grants before recommending repository-wide unattended integrations.

## Maintainer decisions

- **Require region conditions for program membership changes?** Yes. Permit the window's current direct interactions to remain unconditional while the shared dispatcher supports both.
- **Claim durable exactly once in this spike?** No. Approve an atomic SQLite receipt design before production. Server epochs are a fail-closed experiment only.
- **Expose all direct actions immediately?** No. Expose only actions with visible attribution and working Undo, then expand with surface coverage.
- **Allow outside programs to submit exact source changes?** Investigate typed proposals, never approval. Keep held words as the conversational route.

## Stories to file

- S: expose workstream checkpoints as tools, with region versions and explicit data labels.
- M: declare membership conditions in the shared command envelope; test window/agent/program races at commit.
- L: persist tool-scoped command receipts atomically with data changes; cover disconnects, crash recovery, Undo and bounded retention without replay.
- M: close the remaining attribution/Undo gaps before offering each direct action to programs.
- L: workstream-limited read grants, including search, threads and membership-expansion semantics.
- M spike: typed outside proposals captured as a thread's change set, preserving exact mutations and person-only approval.
