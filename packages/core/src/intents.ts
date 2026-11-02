// What becomes of the intents a turn's last run recorded (decision 0024):
// which of an action's fields are the agent's own by default, the calls they
// apply as, and the list the host shows under the agent's reply. All of it
// is read from the registry's declarations, never written per action.
import { type ActionName, actions, type Call } from "./actions.ts";
import type { Ulid } from "./ids.ts";
import type { Intent } from "./sandbox.ts";
import { type Shape, shapeOf } from "./validate.ts";

// What a field names, by the type its declaration says it is.
export type Owned = "workstream" | "thread";
const ownedTypes: Readonly<Record<string, Owned>> = {
  WorkstreamId: "workstream",
  ThreadId: "thread",
};

const unwrapped = (shape: Shape): Shape => (shape.kind === "optional" ? shape.inner : shape);

// An action's input as objects: the one it is, or each alternative of a
// union. The agent's door is generated from these.
export function alternatives(name: ActionName): Extract<Shape, { kind: "object" }>[] {
  const shape = shapeOf(actions[name].input);
  const all = shape.kind === "union" ? shape.alternatives : [shape];
  return all.flatMap((alternative) => (alternative.kind === "object" ? [alternative] : []));
}

// The fields of an object that name a workstream or a thread. The agent may
// leave each out, and it is then the agent's own.
export function ownedFields(shape: Extract<Shape, { kind: "object" }>): Record<string, Owned> {
  const out: Record<string, Owned> = {};
  for (const [key, field] of Object.entries(shape.fields)) {
    const inner = unwrapped(field);
    const owned = inner.kind === "refined" && inner.type ? ownedTypes[inner.type] : undefined;
    if (owned) out[key] = owned;
  }
  return out;
}

// What a call acts on: the workstream and the thread it names, if any.
function target(intent: Intent): string | null {
  const owned = alternatives(intent.action).flatMap((shape) => Object.keys(ownedFields(shape)));
  if (!owned.length) return null;
  return JSON.stringify([...new Set(owned)].sort().map((key) => intent.input[key] ?? null));
}

// Two adjacent calls as one: lists joined, without repeats, and any other
// field as the later call gives it.
function merged(first: Intent, second: Intent): Intent {
  const input: Record<string, unknown> = { ...first.input };
  for (const [key, value] of Object.entries(second.input)) {
    const before = input[key];
    input[key] =
      Array.isArray(before) && Array.isArray(value) ? [...new Set([...before, ...value])] : value;
  }
  return { action: first.action, input };
}

// The calls a turn's intents apply as, in the order the run recorded them.
// Adjacent calls of the same action on the same workstream or thread are
// one call. Marking the agent's own thread done comes last, once.
export function planned(intents: readonly Intent[], own: { thread: Ulid }): Intent[] {
  const calls: Intent[] = [];
  for (const intent of intents) {
    const last = calls.at(-1);
    const at = target(intent);
    if (last && at !== null && last.action === intent.action && target(last) === at)
      calls[calls.length - 1] = merged(last, intent);
    else calls.push(intent);
  }
  const closes = (call: Intent) =>
    call.action === "thread.done" && call.input["thread"] === own.thread;
  const close = calls.find(closes);
  return [...calls.filter((call) => !closes(call)), ...(close ? [close] : [])];
}

// What a call touched, by ID, with its name as it was then: a thread's
// title, null before it has one. A workstream a refused create would have
// made has no ID.
export type Touched = { kind: Owned; id: Ulid | null; name: string | null };

// One line of the host's list under the agent's reply: an intent it applied,
// with the call that undoes it, or one it refused, and why. The model's own
// reply is never the record, and `undo` stays as the apply gave it. `since`:
// what the user did with it from the Undo under the reply, undone or done
// again, and the call the next click sends, if any.
export type ActionLine = { call: Intent; touched: Touched } & (
  | { applied: true; undo: Call | null; since?: { undone: boolean; next: Call | null } }
  | { applied: false; why: string }
);
