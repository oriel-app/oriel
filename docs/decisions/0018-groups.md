# 0018 Groups the user curates; threads follow their group

Accepted 2026-10-29. Amends 0004. Amended by 0024: agents and outside tools add and remove members too, without approval and with Undo. Amended by 0026: a group is now called a workstream; read "group" here as "workstream".

Adds: none

**Decision.**

- **A group** is a user-owned set of items from any source. In phase 1 its members change only in these ways:
  - the user picks items in the window, or turns a cluster into a group (a copy of its members at that moment; the group doesn't follow the cluster afterwards);
  - the user adds a file from a connected folder;
  - the user drops something on a group or one of its threads that names an item the window has: its link, its key, or a connected-folder file with the same name and modified time (added 2026-10-30). Anything else dropped is refused, as links and outside files are below;
  - the user removes an item;
  - a change set applied in one of the group's threads creates an item, which joins the group so later turns can work on it.

  Links, files outside a connected folder, and notes shared between users wait for their own sources.

- **Group versions.** A group keeps a versioned log of its membership. A **region** is one version of it, so threads on the same group share it and nothing is copied per thread.
- **Threads.** A thread is pinned to its group, and a working thread moves to the group's latest version when the group changes, with a visible marker in the chat ("added SYN-12", "removed plan.md").
  - A thread that is done, handed off or dropped keeps its version. A new message makes it working again and catches it up, with markers.
  - A marker alone doesn't count as activity for the 7-day idle rule.
  - A run uses one version from start to end and records it, so evals and replays can reproduce it.
- **Moving around the window** never changes a group or a region; 0004's point stands.
- **What a change set may target:**
  - an item in the version its run used;
  - an item created earlier in the same change set (`new:N`);
  - for a revert, anything the reverted change set touched, whatever the group holds now.

  If an unapplied mutation's target has since left the group, apply stops at it, as at any failure, and says why.

**Why.** The user curates as they go: what matters arrives over time and from anywhere, and a new thread for each new item would throw away the conversation. Versions keep 0004's guarantees: the agent never sees a silent change, and every run can be reproduced. Sharing one log per group keeps storage proportional to the changes, not to the number of threads.

**Consequences.**

- A migration adds groups, a group membership log with versions, and a link from each thread to its group. Runs record the region version they used.
- Bindings and the `.d.ts` are built per version.
- Code that says "group" for a cluster today, in the web app and in region origins, says "cluster" instead.
