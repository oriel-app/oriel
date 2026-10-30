# 0004 Region snapshot, not live camera

Accepted 2026-10-28. Amended by 0018: a thread follows its group, so its region is a versioned snapshot that grows when the user allows items in, never because the camera moved.

**Decision.** A thread is pinned to the set of item IDs captured when it was created, not to whatever is on screen.

**Why.** The agent's bindings and `.d.ts` stay fixed for the thread, evals can reproduce a region exactly, and moving around the window never changes what the agent may write.

**Consequences.** Items added to an epic later aren't in an older region; the user opens a new thread or the agent uses `search()`, read-only. Deleted items degrade to tombstones. Moved items are followed by their stable source ID.
