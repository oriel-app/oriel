# 0003 Change sets, not writes

Accepted 2026-10-28. Amended 2026-11-05 (OA-258): a rejection the person made in the thread can be undone.

**Decision.** Agent code never writes to a source. Writes made in the sandbox are captured as mutations in a change set. A person approves it, in the thread or through its review link, and only then is it replayed. Replay sends exactly the captured arguments, never re-derived ones. One exception: an argument naming an item that an earlier mutation in the same change set creates, such as a new story's new epic, is sent as the ID the source returned for it, as a target naming one already is (added 2026-10-31). Applied change sets keep their reverse diff and can be reverted; a revert is itself a change set.

**Why.** It is what lets a PM trust the agent, and the review link is how Oriel reaches people who aren't in it.

**Consequences.** Enforced in three layers, each tested:

- Types: `SourceWriter.apply` takes only `Approved<…>`, and nothing outside `packages/changeset` may cast to it.
- Runtime: before every write, the writer re-reads the approval and checks the change set's hash, so editing after approval voids it.
- Process: the sandbox has no network. Its only channel is the host, which captures writes.

Each mutation records its status and the source's external ID as soon as the source answers, so a retried replay skips what landed. A revert stops on any field the source changed since apply.

**Undoing a rejection** (amended 2026-11-05, OA-258). Right after the person rejects a change set in the thread, the bead (0056) offers Undo, which puts it back to awaiting review as it was, with its second look, in the thread and in Needs you. Every decision is kept: the rejection is marked undone, so the change set is undecided again, and its next decision is a new one. Its review link stays dead, so the person shares a new one. The thread says so in a line of Oriel's, which the agent reads in its history.

- Only a person may, as only a person approves or rejects: `changeset.unreject` is a person's action, refused to the agent, an outside tool and a review link's holder, and the agent's module has no function for it. The Undo names the rejection it takes back, so it never takes back a later one.
- **Refused, with why the person sees:**
  - a rejection through a review link: the link died with the decision, so its holder has nowhere to undo it from, and the review page tells them to ask whoever shared it. The person in the thread didn't make that decision, and the bead offers them no Undo for it;
  - once the person has said anything to the agent since rejecting, as the reason they give in answer: the agent works from that rejection, and may already have replied or proposed again, so they ask it for the change instead;
  - a change set dismissed after part of it was sent, which is no rejection to take back.
