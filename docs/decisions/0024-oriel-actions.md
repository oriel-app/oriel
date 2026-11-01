# 0024 Oriel's actions: one registry, three doors

Accepted 2026-11-01 (OA-67, OA-74). Amends 0018 and 0019.

Adds: none

**Decision.**

- **One registry of Oriel's own actions.** Everything a person can do in the window that changes Oriel's data is an action. Each is declared once, with:
  - its name (`group.remove`);
  - its input, as a validator;
  - a one-line doc;
  - its class;
  - for any door it is closed to, why.

  A direct action's call returns the call that undoes it, built from what actually changed. Adding A and B when A was already a member undoes as removing B.

- **Three classes.**
  - **Direct:** applied without anyone's approval, with Undo where it has an inverse. This covers Oriel's own data: groups, their members, threads.
  - **Change set:** a write to a source. It is captured, and applied only once a person approves it, as today (0003). Source writes stay declared in their source's catalogue (0019); the registry doesn't declare them again.
  - **Person only:** an action that needs a person in the loop, and it says why. An action is a person's when it is approval, has no Undo, or holds credentials:
    - approve, reject, edit, apply, dismiss and revert of a change set (0003: approval is a person's, in the thread or through a review link);
    - creating and revoking review links (a link hands approval to whoever holds it);
    - connecting a source (it holds credentials and decides what Oriel reads);
    - deleting a thread (it erases what was said, with no Undo).
- **Three doors onto one dispatcher.**
  - **The window's routes.** A route decodes its input, calls the dispatcher and maps its errors. A route that does several things calls the dispatcher once for each, in order: `POST /threads` creates a group, opens a thread and says its first message.
  - **The agent's module.** Each action gets a function in a namespace generated from the registry, as a source's namespace is (0016, 0019).
  - **MCP, for outside tools:** other agents, chat bots, coding agents. It offers one tool per action open to them, described by the same declaration.
- **What the agent may do: anything but a person's actions.** The agent's door is open to every direct action, so the user can tell it to do whatever they could do in the window, short of approving.
  - Each action's thread and group default to the agent's own, so `thread.done()` marks its own thread done. It may name another thread or group in the workspace instead.
  - Its module can read Oriel's own data: groups, their members and threads, with their states. What it reads comes back as tool results, never in the `.d.ts`.
  - `group.add` takes items in its region, or items its `search()` found in that run, as the host checks.
  - **One exception, for now:** opening a thread and saying something in one stay closed. Text the agent writes must show where it came from (which agent, in which thread) before it reaches a thread, or it would read as the user's words. A follow-up story adds that provenance and opens both, with turns it starts counted against the per-thread caps (SPEC §9).

- **The dispatcher** checks the input and refuses an action from an actor its class or doors rule out, whatever door the call came through. It runs the action and records who acted: a person; the agent in a thread; an outside tool; or whoever holds a review link. A review-link holder may only decide or dismiss the change set the link names. Their reason for rejecting is said in the thread, as today, but the turn it starts applies no intents. Who acted is recorded wherever Oriel already records a cause:
  - the group log;
  - a thread's done record;
  - telemetry.

  Each call is counted by its SPEC §7 events, with who acted, where it has them, and otherwise by one `action.called` event. An event already emitted inside the change-set engine stays there, so nothing is counted twice. Each call publishes once to the window's streams, so an open page shows what the agent or a tool did without a reload.

- **The agent's actions are intents,** handled like its writes. The sandbox only records them, and the host caps how many a run may record, as SPEC §9 caps mutations.
  - **One proposal per turn.** A turn's proposal is its last run that finished and captured anything. Its mutations make the turn's change set, and its intents apply. A stopped turn applies none. The turn code shared by every agent owns this rule, so it is written once.
  - **At turn end, in this order:**
    1. The change set is captured.
    2. The intents apply in the order the run recorded them. Calls to the same action on the same group merge into one call, so each group gains at most one version per action, with one marker and one Undo.
    3. Marking the agent's own thread done applies last.

    Marking a thread done is refused while a change set in it waits on the person, or, for the agent's own thread, when this turn proposed one; the thread stays in Needs you.

  - An intent the dispatcher refuses is shown in the thread under the agent's reply, saying why.
  - Intents apply only in a turn a person started. In a turn started by a review-link holder's reason, they are dropped, and the thread says so. Until OA-75 settles the matter, the same goes for an outside tool's words.
  - The region stays the same for the whole turn (0018), so the agent's change shows from its next turn, after the marker.

- **The agent may change any group's members** (amends 0018).
  - Adding widens what that group's threads can propose writes to, from their next turn on. Every write to a source still needs a person's approval.
  - `search()` hits stay read-only: no write takes one. Adding a hit is the agent reaching outside its region in plain sight, so the scope-discipline eval (SPEC §8) counts it as explicit.
  - The change-set diff and the review link mark each item a mutation names, as its target or a reference, that the agent or an outside tool put in the group. An approver who doesn't know the group can then tell.
  - The agent's or a tool's removal is refused when a pending or approved change set in any of the group's threads names the item, because 0018 would stop that change set's apply partway.
- **The agent may mark a thread done** (amends 0019, which left that to the user), as above.
- **Outside tools.** MCP is a door for tools that act on Oriel, not a source that provides items; MCP as a source stays punted (OA-27). A tool's direct actions apply when it calls them.
  - A tool reaches a source write only by saying something in a thread, whose agent proposes a change set that a person approves.
  - Whether a tool may say anything, and how its words show, is part of OA-75, a threat-model spike. So is who may connect, and how.
  - The MCP stories (OA-71..73) wait on OA-75.
- **A repo check keeps the doors in step.** It fails on an action closed to the agent without a reason, and on a POST route that changes state without calling the dispatcher. Three routes are exempt, each with its reason: the window's own telemetry, and the change-set diff and a review link's open, which are reads that record what was shown. The agent's functions are generated from the registry, so none can be missing or describe an action differently. The MCP story extends the check to its tools.
- **In-house, not Effect.** The in-house validator (`packages/core/src/validate.ts`) learns to describe itself: each validator carries a shape, and a `refine` can say the type it narrows to. One declaration then gives the runtime check, the TypeScript type and the `.d.ts` line. The MCP story adds JSON Schema from the same shapes, which the spike showed works.

**Why.**

- Today each agent ability is a one-off, and the agent can't touch groups or threads at all. One registry and one dispatcher give every door the same checks, records and events.
- A change set exists so that a person approves what Oriel writes to other people's systems. Oriel's own data is the user's workspace. Undo protects it well enough, and a second kind of approval would ask the person to review bookkeeping.
- Handling intents like mutations (one run's, at the end of the turn, capped) adds no new timing to learn. It keeps the sandbox's only channel the host, and it keeps 0018's promise that a turn sees one region. Capturing the change set first lets the dispatcher refuse a removal that would break it.
- The user wants to tell the agent to do anything they can do in the window. The line is the person in the loop: approval, what has no Undo, and credentials stay theirs. Everything else the agent does is visible, undoable and recorded as the agent's.
- The agent's input can be steered by source content (SPEC §5). So its actions apply only in a turn a person started, the diff marks each item an agent added, and nothing it does reaches a source without approval.
- Without the check, a door can fall behind the window and nothing notices. Generating the doors from the registry leaves only the reasons to write by hand.
- The spike (OA-74, branch `spike/effect-actions`) built group remove both ways. Both gave the same check and behaviour.
  - To give the four outputs, Effect Schema needed as many annotations as ours.
  - Its code generator wrote `ItemId` as `string`, and a pattern without the `u` flag silently left its JSON Schema. Its types dropped our `Ulid` brand.
  - Its services and typed errors made the dispatcher a second style of code, over stores that are synchronous.
  - It added 59 MB and 2,777 files to the install. It added 82 ms and 225 modules to startup through its main entry, or about 53 ms through subpaths.
  - Neither version touched the web bundle.
  - Effect meets none of SPEC §6's reasons for a dependency.

**Rejected.**

- Group membership as a kind of change set, as in the first draft of 0024 (PR #63). It needed a second kind of mutation, with its own caps, apply order, revert rules and diff lines: about a dozen special cases in `packages/changeset`, for data that Undo already protects.
- Hand-written MCP tools, each with a permission wrapper. Nothing would check that every action has a tool, or that a tool says what its action does.
- Applying each run's intents as it ends. A rerun would leave the first run's changes behind, and a stopped turn would keep them, unlike its writes.
- A short list for the agent (its own group and thread, three actions), as an earlier revision of this decision had it. The user wants to direct the agent across the window, and Undo protects every action the list left out.
- All of Effect, or Effect Schema only (above).

**Consequences.**

- `validate.ts` gains shapes, which changes no call site (the spike's repo typechecked as is). A small module turns a shape into type text.
- The registry's declarations live in `packages/core`, where bindings can read them without importing the server; the handlers live in `packages/server`. Nothing in the registry or its doors reaches a `SourceWriter`.
- The sandbox's result gains intents beside mutations, with their own cap.
- The injection eval (SPEC §8) passes only with zero intents as well as zero mutations.
- The group log's cause, a thread's done record and `thread.marked-done` gain the agent, with its thread, and outside tools. A tool's name is what it says until OA-75.
- Undo moves to where a change shows, including the marker in the thread, and covers additions too. An item the index no longer has can't be added back, as today.
- Every region's module gains Oriel's namespaces, with their reads. The module-size base budget rises once, in the story that adds them, and every eval cassette is recorded again. The `.d.ts` header and `.claude/rules/bindings.md` say that `group.add` takes a search hit and is not a write.
- The window's state-changing routes move onto the dispatcher one by one, and the repo check lands with the first. `POST /groups/:id/remove`, which emits no telemetry today, gets its event then.
- The MCP door waits on OA-75.
