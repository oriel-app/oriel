// Oriel's own actions (decision 0024): everything that changes Oriel's data,
// each declared once, here, where bindings can read it without importing the
// server. A declaration is its name (its key below), its input as a validator
// that describes itself, a one-line doc, its class and its inverse, and why
// any door is closed to it. The server holds the handlers and the one
// dispatcher every door calls. Source writes stay in their source's
// catalogue (decision 0019); they aren't declared again here.
import { isInstant, isItemId, isUlid, type SourceKind, type Ulid } from "./ids.ts";
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
// holds a review link, by the name they typed; a change set, for what
// follows its apply; or a source's sync, for what follows it.
export type Actor =
  | { kind: "user" }
  | { kind: "agent"; threadId: Ulid }
  | { kind: "tool"; name: string }
  | { kind: "review-link"; by: string }
  | { kind: "change-set"; changeSetId: Ulid }
  | { kind: "sync"; source: SourceKind };

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
  // What of its input only the user gives, in the window, each with why: a
  // field, or a union's alternative by its `kind`. The other doors'
  // functions leave it out.
  userOnly?: Readonly<Record<string, string>>;
  // The field whose items join a workstream. The agent's must be in its
  // region or found by its search() in that run, as the host checks.
  joins?: string;
  // A review link's holder may call it too, on the change set the link
  // names, which the change set engine checks by the link's `token`.
  reviewLink?: true;
};

export const maxNameChars = 120;
export const maxItems = 500;
export const maxMessageChars = 8_000;
// Why a review link's holder rejected a change set: they control it, and it
// waits in the thread for the user, so it is shorter than a message.
export const maxReasonChars = 2_000;

const workstreamId = refine(string, isUlid, "expected a workstream ID", { type: "WorkstreamId" });
const threadId = refine(string, isUlid, "expected a thread ID", { type: "ThreadId" });
const changeSetId = refine(string, isUlid, "expected a change set ID", { type: "ChangeSetId" });
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
// What the user types to connect a source. Its checks never quote a value.
const typed = (max: number, what: string) =>
  refine(string, (text) => text.trim() !== "" && text.length <= max, `expected ${what}`);
// A review link's token, which its holder presents.
const token = optional(string);
// Approval is a person's (decision 0003): what each change set action says.
const approval = "Approval is a person's, in the thread or through a review link (decision 0003).";
// Opening a thread and saying something in one, which the agent may not yet.
const unsaid =
  "Text the agent writes must show where it came from before it reaches a thread, or it would read as the user's words (decision 0024).";
const untold = "Whether an outside tool may say anything waits on its threat model (OA-75).";

export const actions = {
  "workstream.add": {
    doc: "Adds items to a workstream. The items themselves don't change.",
    input: object({ workstream: workstreamId, items }),
    class: { kind: "direct", inverse: "workstream.remove" },
    joins: "items",
  },
  "workstream.remove": {
    doc: "Takes items out of a workstream.",
    input: object({ workstream: workstreamId, items }),
    class: { kind: "direct", inverse: "workstream.add" },
  },
  "workstream.create": {
    // From a cluster of the window, from picked items, or empty, for a
    // thread started from nothing.
    doc: "Makes a workstream of the given items.",
    input: union(
      object({ kind: literal("cluster"), grouping: string, cluster: string }),
      object({ kind: literal("picked"), name, items }),
      object({ kind: literal("thread") }),
    ),
    class: { kind: "direct", inverse: "workstream.delete" },
    userOnly: {
      cluster:
        "A cluster's items are the window's: the agent's region and search() don't reach them.",
      thread: "It comes with a thread started from nothing, which only the user starts.",
    },
    joins: "items",
  },
  "workstream.rename": {
    doc: "Names a workstream.",
    // `oriel`: the name is Oriel's, as it was before the user's rename this
    // undoes, so Oriel may name the workstream again. Only the user's Undo says so.
    input: object({ workstream: workstreamId, name, oriel: optional(literal(true)) }),
    class: { kind: "direct", inverse: "workstream.rename" },
    userOnly: { oriel: "Only the user's Undo gives a workstream's name back to Oriel." },
  },
  // Making a workstream's Undo: only while no thread uses it, or ever did,
  // as a deleted thread kept for what it wrote still does.
  "workstream.delete": {
    doc: "Deletes a workstream no thread uses.",
    input: object({ workstream: workstreamId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "A deleted workstream goes with its log, and made again it would be another workstream.",
    },
    closed: {
      agent: "It has no Undo, and what has none stays the user's (decision 0024).",
      tool: "It has no Undo, and what has none stays the user's (decision 0024).",
    },
  },
  "thread.done": {
    doc: "Marks a thread done.",
    input: object({ thread: threadId, via: closeVia }),
    class: { kind: "direct", inverse: "thread.reopen" },
    userOnly: { via: "It says where in the window the user closed the thread from." },
  },
  // Marking done's Undo: a thread marked done works again. One a change set
  // settled, or a hand-off, takes a message instead. `mark`: only the mark
  // made then, so an Undo never takes off a later one.
  "thread.reopen": {
    doc: "Reopens a thread marked done.",
    input: object({
      thread: threadId,
      mark: optional(refine(string, isInstant, "expected when it was marked done")),
    }),
    class: { kind: "direct", inverse: "thread.done" },
    userOnly: { mark: "It names the mark an Undo takes off, which only Oriel gives." },
  },
  "thread.open": {
    doc: "Opens a thread on a workstream, in the workstream's latest version.",
    input: object({ workstream: workstreamId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "Its Undo would delete the thread, which is the user's (decision 0024).",
    },
    closed: { agent: unsaid, tool: untold },
  },
  // The user's message, which starts a turn to answer it.
  "thread.say": {
    doc: "Says something in a thread, which the agent answers.",
    input: object({ thread: threadId, text: messageText }),
    class: {
      kind: "direct",
      inverse: null,
      why: "What was said stays said: only deleting the thread erases it, which is the user's.",
    },
    closed: { agent: unsaid, tool: untold },
  },
  "thread.stop": {
    doc: "Stops the turn running in a thread.",
    input: object({ thread: threadId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "Stopping a turn changes nothing to undo (decision 0024).",
    },
    closed: {
      agent:
        "An intent applies as its turn ends, when its own turn is over, and another thread's turn answers that thread's user.",
    },
  },
  "thread.delete": {
    doc: "Deletes a thread, and its workstream if that was made for it and is empty.",
    input: object({ thread: threadId, via: closeVia }),
    class: { kind: "person-only", why: "It erases what was said (decision 0024)." },
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
  // A change set's own steps, all a person's (decision 0024). What it
  // writes stays declared in its source's catalogue (decision 0019).
  "changeset.edit": {
    doc: "Takes changes out of a change set before it is decided.",
    input: object({
      changeSet: changeSetId,
      remove: refine(
        array(refine(string, isUlid, "expected an ID")),
        (ids) => ids.length > 0,
        "nothing to remove",
      ),
    }),
    class: { kind: "person-only", why: `It changes what a person approves. ${approval}` },
  },
  // `hash`: the diff the person saw, so a change set changed since is refused.
  "changeset.approve": {
    doc: "Approves a change set, which then applies.",
    input: object({ changeSet: changeSetId, hash: string, token }),
    class: { kind: "person-only", why: approval },
    reviewLink: true,
  },
  // The user's reason is their next message; a review link's holder's is
  // held in the thread for the user (decision 0024).
  "changeset.reject": {
    doc: "Rejects a change set, with why.",
    input: object({ changeSet: changeSetId, hash: string, reason: optional(messageText), token }),
    class: { kind: "person-only", why: approval },
    reviewLink: true,
  },
  // Retries an approved change set that stopped partway.
  "changeset.apply": {
    doc: "Applies an approved change set again, from where it stopped.",
    input: object({ changeSet: changeSetId }),
    class: { kind: "person-only", why: `It writes to a source. ${approval}` },
  },
  "changeset.dismiss": {
    doc: "Ends a change set that can go no further.",
    input: object({ changeSet: changeSetId, hash: optional(string), token }),
    class: { kind: "person-only", why: `It ends what a person approved. ${approval}` },
    reviewLink: true,
  },
  "changeset.revert": {
    doc: "Reverts an applied change set, unless its source changed since.",
    input: object({ changeSet: changeSetId }),
    class: { kind: "person-only", why: `It writes to a source. ${approval}` },
  },
  "review-link.create": {
    doc: "Makes a change set's review link, revoking any before it.",
    input: object({ changeSet: changeSetId }),
    class: {
      kind: "person-only",
      why: "A link hands approval to whoever holds it (decision 0024).",
    },
  },
  "review-link.revoke": {
    doc: "Revokes a change set's review link.",
    input: object({ changeSet: changeSetId }),
    class: {
      kind: "person-only",
      why: "It takes back approval a link handed out (decision 0024).",
    },
  },
  // Connecting a source: Jira with the details the user typed, checked
  // against the site first, or the folder at the path they typed.
  "source.connect": {
    doc: "Connects a source, which then syncs into the window.",
    input: union(
      object({
        kind: literal("folder"),
        path: refine(
          string,
          (path) => path.trim() !== "" && path.length <= 1024 && !path.includes("\0"),
          "expected a folder path",
        ),
      }),
      object({
        kind: literal("jira"),
        site: typed(200, "a site"),
        email: typed(254, "an email address"),
        token: typed(1024, "an API token"),
        project: typed(32, "a project key"),
      }),
    ),
    class: {
      kind: "person-only",
      why: "It holds credentials and decides what Oriel reads (decision 0024).",
    },
  },
  // What the user asks for: a full sweep, as only one finds what was
  // deleted in the source.
  "source.sync": {
    doc: "Syncs a source into the window.",
    input: object({ source: union(literal("folder"), literal("jira")) }),
    class: {
      kind: "direct",
      inverse: null,
      why: "Syncing changes nothing to undo (decision 0024): the window catches up with its source.",
    },
    closed: {
      agent:
        "The agent's reads are live already, and an intent applies only as its turn ends, after the run that would read what the sync found.",
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
