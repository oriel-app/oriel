// Oriel's own actions (decision 0024): everything that changes Oriel's data,
// each declared once, here, where bindings can read it without importing the
// server. A declaration is its name (its key below), its input as a validator
// that describes itself, a one-line doc, its class and its inverse, and why
// any door is closed to it. The server holds the handlers and the one
// dispatcher every door calls. Source writes stay in their source's
// catalogue (decision 0019); they aren't declared again here.
import { isItemId, isUlid, type Ulid } from "./ids.ts";
import {
  array,
  type Described,
  type Infer,
  literal,
  number,
  object,
  optional,
  refine,
  string,
  union,
} from "./validate.ts";

// Who acted, recorded with every call: the user, in the window; the agent in
// a thread; an outside tool, by the name it gives (until OA-75); whoever
// holds a review link, by the name they typed; or a change set, for what
// follows its apply.
export type Actor =
  | { kind: "user" }
  | { kind: "agent"; threadId: Ulid }
  | { kind: "tool"; name: string }
  | { kind: "review-link"; by: string }
  | { kind: "change-set"; changeSetId: Ulid };

// The doors besides the window's: the agent's module and MCP.
export type Door = "agent" | "tool";

// Direct: applied at once, and undone by its inverse; one with none says
// why. Person only: never the agent's or a tool's, and says why.
export type ActionClass =
  | { kind: "direct"; inverse: string }
  | { kind: "direct"; inverse: null; why: string }
  | { kind: "person-only"; why: string };

export type ActionDeclaration = {
  doc: string;
  input: Described<unknown>;
  class: ActionClass;
  // The doors it is closed to, each with why.
  closed?: Partial<Record<Door, string>>;
};

export const maxNameChars = 120;
export const maxItems = 500;
export const maxMessageChars = 8_000;
// Why a review link's holder rejected a change set: they control it, and it
// waits in the thread for the user, so it is shorter than a message.
export const maxReasonChars = 2_000;

const workstreamId = refine(string, isUlid, "expected a workstream ID", { type: "WorkstreamId" });
const threadId = refine(string, isUlid, "expected a thread ID", { type: "ThreadId" });
// An entry's place in its thread's chat.
const seq = refine(number, (n) => Number.isInteger(n) && n > 0, "expected a chat entry's place");
const itemId = refine(string, isItemId, "expected an item ID", { type: "ItemId" });
const items = refine(
  array(itemId),
  (list) => list.length > 0 && list.length <= maxItems,
  `expected 1 to ${maxItems} items`,
);
// Where in the window the user closed a thread from.
export const closeVia = optional(union(literal("page"), literal("menu"), literal("swipe")));
// What the user says in a thread.
export const messageText = refine(
  string,
  (text) => text.trim() !== "" && text.length <= maxMessageChars,
  `expected a message of 1 to ${maxMessageChars} characters`,
);
const name = refine(
  string,
  (text) => text.trim() !== "" && [...text].length <= maxNameChars,
  `expected a name of 1 to ${maxNameChars} characters`,
);
// What a review link's holder types, and so controls: the name they give,
// and why they rejected a change set.
export const holderName = name;
export const holderReason = refine(
  string,
  (text) => text.trim() !== "" && text.length <= maxReasonChars,
  `expected a reason of 1 to ${maxReasonChars} characters`,
);

export const actions = {
  "workstream.add": {
    doc: "Adds items to a workstream. The items themselves don't change.",
    input: object({ workstream: workstreamId, items }),
    class: { kind: "direct", inverse: "workstream.remove" },
  },
  "workstream.remove": {
    doc: "Takes items out of a workstream. The items themselves don't change.",
    input: object({ workstream: workstreamId, items }),
    class: { kind: "direct", inverse: "workstream.add" },
  },
  "workstream.create": {
    doc: "Makes a workstream: from a cluster of the window, from picked items, or empty, for a thread started from nothing.",
    input: union(
      object({ kind: literal("cluster"), grouping: string, cluster: string }),
      object({ kind: literal("picked"), name, items }),
      object({ kind: literal("thread") }),
    ),
    class: {
      kind: "direct",
      inverse: null,
      why: "Deleting a workstream no thread uses is its Undo, which comes with the story that shows what the agent did under its reply.",
    },
  },
  "workstream.rename": {
    doc: "Names a workstream.",
    // `oriel`: the name is Oriel's, as it was before the user's rename this
    // undoes, so Oriel may name the group again. Only the user's Undo says so.
    input: object({ workstream: workstreamId, name, oriel: optional(literal(true)) }),
    class: { kind: "direct", inverse: "workstream.rename" },
  },
  "thread.done": {
    doc: "Marks a thread done.",
    input: object({ thread: threadId, via: closeVia }),
    class: {
      kind: "direct",
      inverse: null,
      why: "Reopening a thread is its Undo, which comes with the story that shows what the agent did under its reply.",
    },
  },
  // A held message: words from anyone but the user, such as a review link's
  // holder, which wait in the thread and reach the agent only as the user
  // sends them (decision 0024). Whoever sent it, these settle it.
  "held.send": {
    doc: "Sends a message held in a thread, from anyone but the user, to the agent as the user's message: as it is, or as `text`, the user's edit of it. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq, text: optional(messageText) }),
    class: {
      kind: "person-only",
      why: "Whether the agent hears words from outside the thread is the user's call, and sent on, the words are the user's.",
    },
  },
  "held.discard": {
    doc: "Discards a message held in a thread, from anyone but the user, so the agent never sees it. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq }),
    class: {
      kind: "person-only",
      why: "Whether the agent hears words from outside the thread is the user's call.",
    },
  },
} as const satisfies Record<string, ActionDeclaration>;

export type ActionName = keyof typeof actions;
// A field that may be undefined may be left out, as JSON leaves it.
type Omissible<T> = T extends object
  ? { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] } & {
      [K in keyof T as undefined extends T[K] ? never : K]: T[K];
    }
  : T;
export type ActionInput<N extends ActionName> = Omissible<Infer<(typeof actions)[N]["input"]>>;

// One call of an action: what a direct action's Undo is.
export type Call = { [N in ActionName]: { action: N; input: ActionInput<N> } }[ActionName];

// Whether `name` undoes some action: what an Undo may call.
export const isInverse = (name: string): name is ActionName =>
  Object.values(actions).some(
    (declared: ActionDeclaration) =>
      declared.class.kind === "direct" && declared.class.inverse === name,
  );
