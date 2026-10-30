# 0018 Groups the user curates; threads follow their group

Accepted 2026-10-29. Amends 0004.

Adds: none

**Decision.**

- A **group** is a user-owned set of items from any source. Items enter it only by the user's explicit action, and leave the same way. They enter when the user:
  - picks items in the window;
  - turns a cluster into a group (a copy of its members at that moment);
  - adds a file or link;
  - allows an incoming item in.
- A thread is pinned to a group. Its **region** is a versioned snapshot of the group's members.
  - When the group changes, every open thread on it gets a new region version and a visible marker in its chat ("added SYN-12", "removed notes/plan.md").
  - The next run's bindings and `.d.ts` come from the new version. A run never changes version midway.
- Moving around the window never changes a group or a region; 0004's point stands.
- Each run records its region version, so evals and replays reproduce it exactly.
- A change set may only target items in the latest region version. Apply refuses, with the reason, a mutation whose target has left the group.

**Why.** The user curates as they go: what matters arrives over time and from anywhere, and a new thread for each new item would throw away the conversation. Versions keep 0004's guarantees: the agent never sees a silent change, and every run can be reproduced.

**Consequences.**

- `region_items` gains a version, and runs record theirs (a migration).
- Bindings and the `.d.ts` are built per version.
- The change-set region check uses the latest version.
- A group made from a cluster doesn't follow the cluster afterwards.
