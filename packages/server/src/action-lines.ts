// The host's list under the agent's reply, as the window shows it (decision
// 0024): a plain sentence for each call it applied, and for each it refused,
// with why, naming the workstream or thread it touched. Every action has its
// words here, so one the registry gains can't show without them. An applied
// one offers its Undo, through the one path every Undo takes; once the user
// undid it, it says so and offers the call that does it again, if any.
import { type ActionLine, type ActionName, parseItemId, type Ulid } from "@oriel/core";
import type { ActionLineView } from "@oriel/web/view";

const keyOf = (id: string) => parseItemId(id)?.key ?? id;
const shown = 6;

// "SYN-3", "SYN-3 and SYN-7", "SYN-1, SYN-2 and SYN-3", or, for what wasn't
// done, the first few and how many more. What was done names every item: the
// thread's marker for it folds into this line, which is then its record.
function listed(value: unknown, every = false): string {
  const keys = [...new Set(Array.isArray(value) ? value : [])].map((id) => keyOf(String(id)));
  if (keys.length > shown && !every)
    return `${keys.slice(0, shown).join(", ")} and ${keys.length - shown} more`;
  if (keys.length < 2) return keys.join("");
  return `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
}

// As the workstream has it: a name is trimmed when it is given.
const quoted = (name: unknown) => `“${String(name).trim()}”`;

// What each action did, then what it would have done, given its input, the
// place it touched, and what its undo gives back: the items an add added,
// none of those it already had, and a rename's name before, none when the
// name was already that.
type Words = (
  input: Record<string, unknown>,
  place: string,
  undo: Record<string, unknown> | null,
) => [string, string];

const words: { [N in ActionName]: Words } = {
  "workstream.add": (input, place, undo) => [
    undo
      ? `Added ${listed(undo["items"], true)} to ${place}`
      : `Added nothing to ${place}: it already had ${listed(input["items"])}`,
    `add ${listed(input["items"])} to ${place}`,
  ],
  "workstream.remove": (input, place) => [
    `Removed ${listed(input["items"], true)} from ${place}`,
    `remove ${listed(input["items"])} from ${place}`,
  ],
  "workstream.create": (input) => [
    `Made the workstream ${quoted(input["name"])} with ${listed(input["items"], true)}`,
    `make the workstream ${quoted(input["name"])}`,
  ],
  "workstream.rename": (input, place, undo) => [
    undo === null
      ? `Left ${place} named ${quoted(input["name"])}, as it already was`
      : `Renamed ${quoted(undo["name"])} to ${quoted(input["name"])}`,
    `rename ${place} to ${quoted(input["name"])}`,
  ],
  "workstream.delete": (_, place) => [`Deleted ${place}`, `delete ${place}`],
  // Marked done already, it keeps who marked it, and there is nothing to undo.
  "thread.done": (_, place, undo) => [
    undo === null ? `Left ${place} marked done, as it already was` : `Marked ${place} done`,
    `mark ${place} done`,
  ],
  "thread.reopen": (_, place) => [`Reopened ${place}`, `reopen ${place}`],
  // A person's, or closed to the agent, so never the agent's; worded all the
  // same.
  "thread.open": (_, place) => [`Opened a thread on ${place}`, `open a thread on ${place}`],
  "thread.say": (_, place) => [`Said something in ${place}`, `say something in ${place}`],
  "thread.stop": (_, place) => [`Stopped the turn in ${place}`, `stop the turn in ${place}`],
  "thread.delete": (_, place) => [`Deleted ${place}`, `delete ${place}`],
  "held.send": (_, place) => [`Sent a held message in ${place}`, `send a held message in ${place}`],
  "held.discard": (_, place) => [
    `Discarded a held message in ${place}`,
    `discard a held message in ${place}`,
  ],
  "changeset.edit": () => ["Edited a change set", "edit a change set"],
  "changeset.approve": () => ["Gave a change set its approval", "approve a change set"],
  "changeset.reject": () => ["Rejected a change set", "reject a change set"],
  "changeset.apply": () => ["Applied a change set", "apply a change set"],
  "changeset.dismiss": () => ["Dismissed a change set", "dismiss a change set"],
  "changeset.revert": () => ["Reverted a change set", "revert a change set"],
  "review-link.create": () => ["Made a review link", "make a review link"],
  "review-link.revoke": () => ["Revoked a review link", "revoke a review link"],
  "source.connect": () => ["Connected a source", "connect a source"],
  "source.sync": (input) => [`Synced ${input["source"]}`, `sync ${input["source"]}`],
};

// One line as the window shows it, in the thread `own` whose agent asked.
export function actionLineView(
  line: ActionLine,
  own: { thread: Ulid; workstream: Ulid },
): ActionLineView {
  const { touched, call } = line;
  const mine = touched.id !== null && touched.id === own[touched.kind];
  const place = mine
    ? `this ${touched.kind}`
    : touched.name
      ? quoted(touched.name)
      : `a ${touched.kind}`;
  const undo = line.applied && line.undo ? (line.undo.input as Record<string, unknown>) : null;
  const [done, not] = words[call.action](call.input, place, undo);
  const undone = line.applied && line.since?.undone === true;
  const offer = line.applied ? (line.since ? line.since.next : line.undo) : null;
  return {
    text: line.applied
      ? `${done}${undone ? ", which you undid" : ""}.`
      : `Didn't ${not}: ${line.why}.`,
    applied: line.applied,
    ...(undone ? { undone: true as const } : {}),
    why: line.applied ? null : line.why,
    // Nothing links to the thread the list is in.
    touched:
      touched.id === null || (mine && touched.kind === "thread")
        ? null
        : { kind: touched.kind, id: touched.id },
    undo: offer && { action: offer.action, input: offer.input },
  };
}
