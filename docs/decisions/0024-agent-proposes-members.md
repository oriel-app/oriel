# 0024 The agent proposes a group's members in change sets

Accepted 2026-11-01 (OA-42). Amends 0018.

Adds: none

**Decision.**

- **The agent may propose** putting items into its thread's group or taking them out ("remove the done stories"). It never changes membership itself. Each change it proposes is a mutation in the run's change set, beside any writes to sources, so one diff, one hash, one approval, one review link and one revert cover both. Nothing changes until a person approves.
- **In the module**, a `group` namespace has two writes, one item each:
  - `group.remove(id: RegionId)`: an item in the version the run used.
  - `group.add(id: FoundId)`: an item this run's `search()` returned that the version doesn't hold. It is the only write that takes a search result; every other write still refuses one.

  The host refuses a change that wouldn't change the version, and the same item twice. An item a create in the change set makes (`new:N`) needs neither: it joins when it is created (0018).

- **They are Oriel's own ops, not a source's.** They change the group, never the item, so they need no writer or writable connection, and they work on items of any source, read-only ones included. Each is a line of its own in the diff, which says the item itself doesn't change.
- **Which item.** Capture records each item's stable ID with it, read from the index, so the hash covers it and apply changes exactly the item the person approved, even if its key moves to another item. Bindings enforce that an added item came from the run's `search()`. The engine checks that it is indexed and outside the run's version.
- **Caps.** Membership changes have their own cap per run and per change set, 100 each, apart from the 20 for writes: each changes only Oriel's record and reverts exactly, and a group's done stories can outnumber 20.
- **Apply.**
  - In every change set, a revert's included, capture puts membership changes after the writes to sources.
  - Under the change set's approval, checked against its hash as for any mutation, once every write before them has applied, they take one new version of the group, caused by the change set. Adds and removes go into that version together, in the same transaction that marks them applied.
  - If one can't apply (an item to add that the index no longer has), none does: apply stops at it and says why, as at any failure, and they stay pending.
  - One the group already shows, whoever made it since (the user, or another thread's change set), changes nothing and counts as applied. 0018's rule that apply stops at a target that has left the group is for writes to sources.
- **The region moves, with a marker.** The thread whose change set made a version moves to it with its marker ("removed SYN-3"), even though applying the change set settles the thread. The group's other working threads follow as for any change (0018). So a thread that asked about v3 shows, under its approved change set, that it now works in v4. This holds for the version a change set's creates make, too.
- **Revert.** Reverting proposes the opposite change for each membership change that applied, approved like any revert, and takes another version. If a later version added or removed that item, the revert stops on it as a conflict rather than undo that later change (SPEC §7). One that changed nothing reverts to nothing.
- **A membership change isn't a write to a source.** What a thread says it wrote, and to which sources, leaves membership changes out. Once applied, one still settles the thread, as any applied change set does, and a deleted thread that made one keeps its records, so the group's log never names a change set that is gone.
- **Telemetry.** `group.item-added` and a new `group.item-removed` carry the cause `change-set`.

**Why.**

- The user asked for this to work as the agent's writes do: it proposes, they approve. A change set already gives a diff, an approval bound to a hash, the review link, Needs you, the Done page and revert, and the agent already knows how to make one. A second kind of proposal would need each of those again.
- One request can then be one review: "move the done stories to a new epic and take them out of this group".
- Additions come only from `search()` results, so the agent adds only items the window has indexed and that it found, not IDs it typed.
- The agent still can't reach membership any other way: as with writes, the sandbox's only channel is the host, which captures, and only the change-set engine applies, under an approval.
- Membership changes go after the writes, so a write in the same change set to an item it takes out still targets a member. One version per change set gives the thread one marker for what the person approved.
- Without moving the proposing thread, a settled thread would keep v3, and the change the user approved would show only after their next message.

**Rejected.**

- A membership proposal beside change sets: a second approve button, review link, Needs you entry and revert for the same idea.
- Letting the agent change membership directly because it isn't a write to a source: the region would change without the user's say, which 0004 and 0018 rule out.
- `items.add` and `items.remove`: they read as creating and deleting the item.
- One call naming many items, as one diff line: a person couldn't leave one item out, and a revert conflict on one would stop them all.
- Letting `group.add` take any ID the agent types.

**Consequences.**

- Every region's module declares the `group` namespace, about 300 bytes on every request, so every eval cassette is recorded again.
- The change-set engine applies and reverts membership changes itself, through the group store, which gains one change that adds and removes together. A diff line says whether it puts an item into the group or takes one out.
- `.claude/rules/bindings.md` and the `FoundId` docs say that `group.add` is the one write that takes a search result.
