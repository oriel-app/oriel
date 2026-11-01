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

const groupId = refine(string, isUlid, "expected a group ID", { type: "GroupId" });
const threadId = refine(string, isUlid, "expected a thread ID", { type: "ThreadId" });
const itemId = refine(string, isItemId, "expected an item ID", { type: "ItemId" });
const items = refine(
  array(itemId),
  (list) => list.length > 0 && list.length <= maxItems,
  `expected 1 to ${maxItems} items`,
);
const name = refine(
  string,
  (text) => text.trim() !== "" && [...text].length <= maxNameChars,
  `expected a name of 1 to ${maxNameChars} characters`,
);

export const actions = {
  "group.add": {
    doc: "Adds items to a group. The items themselves don't change.",
    input: object({ group: groupId, items }),
    class: { kind: "direct", inverse: "group.remove" },
  },
  "group.remove": {
    doc: "Takes items out of a group. The items themselves don't change.",
    input: object({ group: groupId, items }),
    class: { kind: "direct", inverse: "group.add" },
  },
  "group.create": {
    doc: "Makes a group: from a cluster of the window, from picked items, or empty, for a thread started from nothing.",
    input: union(
      object({ kind: literal("cluster"), grouping: string, cluster: string }),
      object({ kind: literal("picked"), name, items }),
      object({ kind: literal("thread") }),
    ),
    class: {
      kind: "direct",
      inverse: null,
      why: "Deleting a group no thread uses is its Undo, which comes with the story that shows what the agent did under its reply.",
    },
  },
  "group.rename": {
    doc: "Names a group.",
    input: object({ group: groupId, name }),
    class: { kind: "direct", inverse: "group.rename" },
  },
  "thread.done": {
    doc: "Marks a thread done.",
    // `via`: where in the window the user closed it from.
    input: object({
      thread: threadId,
      via: optional(union(literal("page"), literal("menu"), literal("swipe"))),
    }),
    class: {
      kind: "direct",
      inverse: null,
      why: "Reopening a thread is its Undo, which comes with the story that shows what the agent did under its reply.",
    },
  },
} as const satisfies Record<string, ActionDeclaration>;

export type ActionName = keyof typeof actions;
export type ActionInput<N extends ActionName> = Infer<(typeof actions)[N]["input"]>;

// One call of an action: what a direct action's Undo is.
export type Call = { [N in ActionName]: { action: N; input: ActionInput<N> } }[ActionName];

export const isActionName = (name: string): name is ActionName => Object.hasOwn(actions, name);
