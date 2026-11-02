// The host's list under the agent's reply, as the window shows it (decision
// 0024): a plain sentence for each call it applied, and for each it refused,
// with why, naming the workstream or thread it touched. Every action has its
// words here, so one the registry gains can't show without them.
import { type ActionLine, type ActionName, parseItemId, type Ulid } from "@oriel/core";
import type { ActionLineView } from "@oriel/web/view";

const keyOf = (id: string) => parseItemId(id)?.key ?? id;
const shown = 6;

// "SYN-3", "SYN-3 and SYN-7", "SYN-1, SYN-2 and SYN-3", or the first few and
// how many more.
function listed(value: unknown): string {
  const keys = (Array.isArray(value) ? value : []).map((id) => keyOf(String(id)));
  if (keys.length > shown)
    return `${keys.slice(0, shown).join(", ")} and ${keys.length - shown} more`;
  if (keys.length < 2) return keys.join("");
  return `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`;
}

const quoted = (name: unknown) => `“${String(name)}”`;

// What each action did, then what it would have done, given its input, the
// place it touched, and an applied rename's name before.
type Words = (
  input: Record<string, unknown>,
  place: string,
  was: string | null,
) => [string, string];

const words: { [N in ActionName]: Words } = {
  "workstream.add": (input, place) => [
    `Added ${listed(input["items"])} to ${place}`,
    `add ${listed(input["items"])} to ${place}`,
  ],
  "workstream.remove": (input, place) => [
    `Removed ${listed(input["items"])} from ${place}`,
    `remove ${listed(input["items"])} from ${place}`,
  ],
  "workstream.create": (input) => [
    `Made the workstream ${quoted(input["name"])} with ${listed(input["items"])}`,
    `make the workstream ${quoted(input["name"])}`,
  ],
  "workstream.rename": (input, place, was) => [
    was === null
      ? `Named ${place} ${quoted(input["name"])}`
      : `Renamed ${quoted(was)} to ${quoted(input["name"])}`,
    `rename ${place} to ${quoted(input["name"])}`,
  ],
  "thread.done": (_, place) => [`Marked ${place} done`, `mark ${place} done`],
  // A person's, so never the agent's; worded all the same.
  "held.send": (_, place) => [`Sent a held message in ${place}`, `send a held message in ${place}`],
  "held.discard": (_, place) => [
    `Discarded a held message in ${place}`,
    `discard a held message in ${place}`,
  ],
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
  // A rename undoes as renaming back to the name it had.
  const was =
    line.applied && line.undo?.action === "workstream.rename" ? String(line.undo.input.name) : null;
  const [done, not] = words[call.action](call.input, place, was);
  return {
    text: line.applied ? `${done}.` : `Didn't ${not}: ${line.why}.`,
    applied: line.applied,
    why: line.applied ? null : line.why,
    // Nothing links to the thread the list is in.
    touched:
      touched.id === null || (mine && touched.kind === "thread")
        ? null
        : { kind: touched.kind, id: touched.id },
    undo: line.applied && line.undo ? { action: line.undo.action, input: line.undo.input } : null,
  };
}
