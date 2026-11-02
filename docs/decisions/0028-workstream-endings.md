# 0028 A workstream ends done or deleted

Accepted 2026-11-01 (OA-124). Amends 0018 and 0024. Changes SPEC §2's glossary and §7's telemetry list.

Adds: none

**Decision.**

- **A workstream is open, done or deleted.** It is open until someone marks it done or the user deletes it.
- **Done** (`workstream.done`, undone by `workstream.reopen`).
  - Marking a workstream done marks each of its open threads done, working or dropped, as whoever did it. A thread already done or handed off keeps its state, and who first marked it (OA-119).
  - Each mark records when, who, and which threads it marked done.
  - A workstream is done while it has a mark and none of its threads is working. A message in one of its threads, or a new thread on it, makes it open again, as a message reopens a settled thread. Its marks stay, and marking it done again adds one.
  - Reopening takes every mark off and reopens the threads each marked, but only those still carrying that mark, so a thread done before, or marked again since, stays done. An Undo takes off only the mark it undoes, while it is the latest.
  - A done workstream leaves the sidebar and shows on the Done page, with its members and log kept. Its page stays reachable from there and says it's done.
  - Direct, open to the agent and to outside tools. As with `thread.done`, the host refuses them while a change set or held message in any of its threads waits on the person, or while a turn runs in another of its threads.
  - Nothing is written to a source.
- **Deleted** (`workstream.delete`, undone by `workstream.restore`).
  - A workstream that no thread uses, or ever did, is deleted with its log, as before, and has no Undo.
  - Otherwise deleting hides it, with every thread on it. Hidden means hidden everywhere, from the agent too: the sidebar, Needs you, the Done page, search, the agent's reads and every route. The rows stay, so its Undo, `workstream.restore`, brings everything back as it was.
  - The person confirms first, told how many threads go with it. The call carries that count, and the host refuses it once the workstream has a different number of threads, so a thread opened since the confirmation is never deleted unseen. A call without a count is one for a workstream no thread uses, as Undo of making one is.
  - Not while a turn runs in one of its threads, or one of their change sets is applying.
  - A review link to a change set in a deleted workstream says the workstream was deleted and can't be decided. Restoring it makes the link work again, until it would have expired anyway.
  - Deleting and restoring are closed to the agent and to outside tools: they hide, or bring back, what was said in the threads, which is the user's call, as deleting a thread is.
- **Telemetry.** `workstream.marked-done` counts the mark with how many threads it marked done, and each of those threads counts as `thread.marked-done`, naming the workstream, for its time to done. `workstream.deleted` counts a delete with how many threads went with it, and whether its rows were kept. Reopening and restoring are counted as `action.called`, with whose action they undid.

**Why.**

- A workstream had no way to end. `workstream.delete` refused any workstream a thread used, and the agent told the maintainer to delete one in Oriel, which wasn't possible.
- Done is the usual ending: the work finished, and its record should stay in sight with its threads. Recording the threads it marked lets its Undo put back exactly what it changed.
- Deriving done, as a thread's state is derived, means a workstream someone comes back to returns to the sidebar without anyone reopening it.
- Deleting a workstream with threads erases nothing that 0024 keeps the person's. It hides, and Undo protects it. Confirming with the count keeps a delete from taking a thread the person didn't know about.

**Rejected.**

- Deleting a used workstream's rows, as an empty one's are. A thread that wrote to a source must keep its records (SPEC §1.2, §7), and there would be no Undo.
- Revoking a deleted workstream's review links, as deleting a thread does. Restoring it couldn't bring them back.
- A stored workstream state that a message doesn't change. A working thread under a done workstream would be out of sight in the sidebar.

**Consequences.**

- A migration adds `workstream_done_marks` (each mark: when, who and the threads it marked) and `deleted_workstreams`. The stores hide a deleted workstream, and its threads, from every list and lookup.
- The agent's module gains `workstream.done` and `workstream.reopen`, and `OrielWorkstream` gains `done`. The module-size base rises, and every eval cassette is recorded again.
- The workstream page's header has Mark done or Reopen, and Delete, which asks first; its menu, in the sidebar and on the Done page, and its swipe in the sidebar, offer the same. Each shows what it did with Undo, through the one Undo path.
