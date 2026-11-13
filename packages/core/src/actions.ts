import { lookingAt } from "./about.ts";
import { isInstant, isItemId, isPrefix, isUlid, type SourceKind, type Ulid } from "./ids.ts";
import {
  array,
  type Described,
  type Infer,
  literal,
  number,
  object,
  optional,
  record,
  refine,
  string,
  union,
  unknown,
} from "./validate.ts";

// An outside tool is named by the name the user gave it, never what it says of itself.
export type Actor =
  | { kind: "user" }
  | { kind: "agent"; threadId: Ulid }
  | { kind: "tool"; name: string }
  | { kind: "review-link"; by: string }
  | { kind: "change-set"; changeSetId: Ulid }
  | { kind: "sync"; source: SourceKind };

export type Door = "agent" | "tool";

export type ActionClass =
  | { kind: "direct"; inverse: string }
  | { kind: "direct"; inverse: null; why: string }
  | { kind: "person-only"; why: string; inverse?: string };

export type ActionDeclaration = {
  doc: string;
  input: Described<unknown>;
  class: ActionClass;
  closed?: Partial<Record<Door, string>>;
  userOnly?: Readonly<Record<string, string>>;
  joins?: string;
  reviewLink?: true;
  draftable?: true | "window";
};

export const maxNameChars = 120;
export const maxItems = 500;
export const maxMessageChars = 8_000;
// The holder controls it, and it waits in the thread for the user, so it's shorter than a message.
export const maxReasonChars = 2_000;

const noticedSignal = refine(
  string,
  (id) => id.length > 0 && id.length <= 200,
  "expected a signal's ID",
);
const workstreamId = refine(string, isUlid, "expected a workstream ID", { type: "WorkstreamId" });
const threadId = refine(string, isUlid, "expected a thread ID", { type: "ThreadId" });
const changeSetId = refine(string, isUlid, "expected a change set ID", { type: "ChangeSetId" });
const seq = refine(number, (n) => Number.isInteger(n) && n > 0, "expected a chat entry's place");
const itemId = refine(string, isItemId, "expected an item ID", { type: "ItemId" });
const items = refine(
  array(itemId),
  (list) => list.length > 0 && list.length <= maxItems,
  `expected 1 to ${maxItems} items`,
);
export const closeVia = optional(
  union(
    literal("page"),
    literal("menu"),
    literal("swipe"),
    literal("new-chat"),
    literal("continue"),
  ),
);
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
export const maxToolNameChars = 60;
export const toolName = refine(
  string,
  (text) => text.trim() !== "" && [...text].length <= maxToolNameChars,
  `expected a name of 1 to ${maxToolNameChars} characters`,
);
export const holderReason = refine(
  string,
  (text) => text.trim() !== "" && text.length <= maxReasonChars,
  `expected a reason of 1 to ${maxReasonChars} characters`,
);
const connectionId = refine(string, isUlid, "expected a connection ID", { type: "ConnectionId" });
const sourceKind = refine(
  string,
  (kind) => isPrefix(kind) && !kind.includes("."),
  "expected a kind",
);
const serverName = refine(
  string,
  (name) => name.trim() !== "" && name.length <= 200,
  "expected a source server's name",
);
const configures =
  "How a connection reads its source is the user's to set: the agent may draft it, but only the user applies it (decision 0049).";
const token = optional(string);
const approval = "Approval is a person's, in the thread or through a review link (decision 0003).";
const secondLook =
  "A second look is a model call the person asks for, on what an agent proposed: an agent doesn't ask for one of its own work, and an outside tool's words start no model call (decision 0054).";
const unsaid =
  "Text the agent writes must show where it came from before it reaches a thread, or it would read as the user's words (decision 0024).";
const untold = "An outside tool's words in a thread are held for the user, which OA-73 builds.";
const undoless =
  "An outside tool's call of it doesn't yet show in the window as the tool's, with Undo (decision 0058).";
const hides =
  "It has no Undo when no thread ever used the workstream, and otherwise it hides what was said in its threads, which is the user's call (decision 0028).";
const unhides =
  "It brings back what was said in a deleted workstream's threads, which is the user's call (decision 0028).";

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
    doc: "Makes a workstream of the given items.",
    input: union(
      object({ kind: literal("cluster"), grouping: string, cluster: string }),
      object({ kind: literal("picked"), name, items }),
      object({ kind: literal("thread"), name: optional(name) }),
      object({ kind: literal("window") }),
    ),
    class: { kind: "direct", inverse: "workstream.delete" },
    userOnly: {
      cluster:
        "A cluster's items are the window's: the agent's region and search() don't reach them.",
      thread: "It comes with a thread started from nothing, which only the user starts.",
      window: "It comes with the window chat's first question, which only the user asks.",
    },
    joins: "items",
    closed: { tool: undoless },
  },
  "workstream.rename": {
    doc: "Names a workstream.",
    // `oriel`: only the user's Undo of a rename sets it, so Oriel may name the workstream again.
    input: object({ workstream: workstreamId, name, oriel: optional(literal(true)) }),
    class: { kind: "direct", inverse: "workstream.rename" },
    userOnly: { oriel: "Only the user's Undo gives a workstream's name back to Oriel." },
    closed: { tool: undoless },
  },
  // `mark`: only the mark made then, so an Undo never takes off a later one.
  "workstream.done": {
    doc: "Marks a workstream done, with its open threads.",
    input: object({ workstream: workstreamId }),
    class: { kind: "direct", inverse: "workstream.reopen" },
    closed: { tool: undoless },
  },
  "workstream.reopen": {
    doc: "Reopens a done workstream and the threads it closed.",
    input: object({
      workstream: workstreamId,
      mark: optional(refine(string, isInstant, "expected when it was marked done")),
    }),
    class: { kind: "direct", inverse: "workstream.done" },
    userOnly: { mark: "It names the mark an Undo takes off, which only Oriel gives." },
    closed: { tool: undoless },
  },
  // `threads`: how many the user was told go with it, so a thread opened since never goes unseen.
  "workstream.delete": {
    doc: "Deletes a workstream, with its threads.",
    input: object({
      workstream: workstreamId,
      threads: optional(
        refine(number, (n) => Number.isInteger(n) && n >= 0, "expected how many threads go"),
      ),
    }),
    class: { kind: "direct", inverse: "workstream.restore" },
    closed: { agent: hides, tool: hides },
  },
  "workstream.restore": {
    doc: "Brings back a deleted workstream, with its threads.",
    input: object({ workstream: workstreamId }),
    class: { kind: "direct", inverse: "workstream.delete" },
    closed: { agent: unhides, tool: unhides },
  },
  "thread.done": {
    doc: "Marks a thread done.",
    input: object({ thread: threadId, via: closeVia }),
    class: { kind: "direct", inverse: "thread.reopen" },
    userOnly: { via: "It says where in the window the user closed the thread from." },
    closed: { tool: undoless },
  },
  // `mark`: only the mark made then, so an Undo never takes off a later one.
  "thread.reopen": {
    doc: "Reopens a thread marked done.",
    input: object({
      thread: threadId,
      mark: optional(refine(string, isInstant, "expected when it was marked done")),
    }),
    class: { kind: "direct", inverse: "thread.done" },
    userOnly: { mark: "It names the mark an Undo takes off, which only Oriel gives." },
    closed: { tool: undoless },
  },
  "window.new-chat": {
    doc: "Starts a fresh window chat, and marks the old one done unless it waits on the user.",
    input: object({}),
    class: {
      kind: "direct",
      inverse: null,
      why: "It changes only which chat the window shows; reopening the old chat undoes its mark.",
    },
    closed: {
      agent: "It changes what the user's window shows, which is the user's.",
      tool: "It changes what the user's window shows, which is the user's.",
    },
  },
  "window.open-as-thread": {
    doc: "Makes the window chat its workstream's own thread, and starts a fresh window chat.",
    input: object({ thread: threadId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "It changes only which chat the window shows; the thread and its workstream stay.",
    },
    closed: {
      agent: "It changes what the user's window shows, which is the user's.",
      tool: "It changes what the user's window shows, which is the user's.",
    },
  },
  "window.continue": {
    doc: "Continues the request in the item's workstream.",
    input: object({ thread: threadId, item: itemId, seq: optional(seq) }),
    class: {
      kind: "direct",
      inverse: null,
      why: "It opens a thread and sends the user's own words there; only deleting the thread erases them.",
    },
    userOnly: {
      thread: "Oriel names the window chat it continues.",
      seq: "Oriel names the message the draft answers.",
    },
    closed: { agent: unsaid, tool: untold },
    draftable: "window",
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
  // A thread never changes workstream: its region versions and change sets only mean anything on its own.
  "thread.continue": {
    doc: "Goes on with a thread's conversation in a new thread on another workstream.",
    input: object({ thread: threadId, workstream: workstreamId }),
    class: {
      kind: "person-only",
      why: "Where the user's conversation goes on is the user's call.",
      inverse: "thread.uncontinue",
    },
  },
  "thread.uncontinue": {
    doc: "Undoes Continue in…: deletes the new thread and reopens the one it came from.",
    input: object({
      thread: threadId,
      mark: optional(refine(string, isInstant, "expected when it was marked done")),
    }),
    class: {
      kind: "person-only",
      why: "It deletes a thread, which is the user's (decision 0024).",
    },
  },
  "thread.say": {
    doc: "Says something in a thread, which the agent answers.",
    input: object({ thread: threadId, text: messageText, about: optional(lookingAt) }),
    class: {
      kind: "direct",
      inverse: null,
      why: "What was said stays said: only deleting the thread erases it, which is the user's.",
    },
    closed: { agent: unsaid, tool: untold },
  },
  "thread.retry": {
    doc: "Answers again the message whose turn failed in a thread.",
    input: object({ thread: threadId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "It changes nothing to undo: the turn answers the message the user already sent.",
    },
    closed: {
      agent: "A turn that failed has ended, and with it the agent's part in it.",
      tool: "Answering the user's message again is the user's call about their own turn, which steered words shouldn't make (decision 0058).",
    },
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
      tool: "Stopping a turn is the user's call about their own turn, which steered words shouldn't make (decision 0058).",
    },
  },
  "thread.sync": {
    doc: "Moves a thread to its workstream's latest version, with a marker in its chat.",
    input: object({ thread: threadId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "A thread works in its workstream's latest version from then on; its marker says where it moved.",
    },
    closed: {
      agent:
        "A turn works in the version it started in, and another thread's version is its user's to move.",
      tool: "A thread's version is its user's to move, under them (decision 0058).",
    },
  },
  "thread.delete": {
    doc: "Deletes a thread, and its workstream if that was made for it and is empty.",
    input: object({ thread: threadId, via: closeVia }),
    class: { kind: "person-only", why: "It erases what was said (decision 0024)." },
  },
  // Held words reach the agent only as the user sends them.
  "held.send": {
    doc: "Sends a message held in a thread, from anyone but the user, to the agent as the user's message: as it is, or as `text`, the user's edit of it. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq, text: optional(messageText) }),
    class: {
      kind: "person-only",
      why: "Whether the agent hears words from outside the thread is the user's call, and sent on, the words are the user's.",
    },
  },
  "held.discard": {
    doc: "Discards a message held in a thread, from anyone but the user, so the agent never sees it, or a draft, so it never applies. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq }),
    class: {
      kind: "person-only",
      why: "Whether the agent hears words from outside the thread is the user's call.",
    },
  },
  "held.apply": {
    doc: "Applies a draft held in a thread, as it is, or with `edit`, the user's changes to its input. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq, edit: optional(record(unknown)) }),
    class: {
      kind: "person-only",
      why: "A draft is the agent's suggestion of the user's own action, so only the user applies it, in the window (decision 0051).",
    },
  },
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
  "changeset.reject": {
    doc: "Rejects a change set; a review link's holder says why.",
    input: object({ changeSet: changeSetId, hash: string, reason: optional(messageText), token }),
    class: { kind: "person-only", why: approval, inverse: "changeset.unreject" },
    reviewLink: true,
  },
  // `decision`: the rejection it takes back, so an Undo never takes back a later one.
  "changeset.unreject": {
    doc: "Undoes a rejection made in the thread, so the change set awaits review again.",
    input: object({
      changeSet: changeSetId,
      decision: refine(string, isUlid, "expected a decision's ID"),
    }),
    class: {
      kind: "person-only",
      why: `Taking a rejection back decides the change set again. ${approval}`,
    },
  },
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
  "changeset.second-look": {
    doc: "Takes a second look at a change set, or another once the last went stale or failed.",
    input: object({ changeSet: changeSetId }),
    class: {
      kind: "direct",
      inverse: null,
      why: "A second look changes nothing a person approves: it informs.",
    },
    closed: { agent: secondLook, tool: secondLook },
  },
  "changeset.dismiss-look": {
    doc: "Dismisses a change set's second look, stopping it if it still runs.",
    input: object({
      changeSet: changeSetId,
      look: refine(string, isUlid, "expected a second look's ID"),
    }),
    class: {
      kind: "direct",
      inverse: null,
      why: "Second look shows a dismissed look again while it is current, with no model call.",
    },
    closed: { agent: secondLook, tool: secondLook },
  },
  "changeset.add-suggestion": {
    doc: "Adds changes a second look suggested to a change set.",
    input: object({
      changeSet: changeSetId,
      look: refine(string, isUlid, "expected a second look's ID"),
      places: refine(
        array(
          refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a suggestion's place"),
        ),
        (places) => places.length > 0 && new Set(places).size === places.length,
        "expected one or more suggestions, each once",
      ),
    }),
    class: { kind: "person-only", why: `It changes what a person approves. ${approval}` },
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
  // The one way a source's item changes without a change set, and only from the person's own hand.
  "item.edit": {
    doc: "Edits a stand-in's item, as its panel's form does.",
    input: object({ item: itemId, values: record(unknown) }),
    class: {
      kind: "person-only",
      why: "A source's item changes only through a change set the person approves; a stand-in's panel is the person's own hand on it (decision 0059).",
      inverse: "item.edit",
    },
  },
  "source.connect": {
    doc: "Connects a source, which then syncs into the window.",
    input: object({ kind: sourceKind, given: unknown }),
    class: {
      kind: "person-only",
      why: "It holds credentials and decides what Oriel reads (decision 0024).",
    },
  },
  "source.configure": {
    doc: "Sets a connection's options, which its next sync reads with.",
    input: object({ connection: connectionId, options: unknown }),
    class: { kind: "direct", inverse: "source.configure" },
    closed: { agent: configures, tool: configures },
    draftable: true,
  },
  // On gives Oriel's sync that server's read tools, so only a person turns a kind on.
  "source.off": {
    doc: 'Turns a source kind, such as "slack", off until the user turns it on in Settings.',
    input: object({ kind: sourceKind }),
    class: { kind: "direct", inverse: "source.on" },
    closed: { tool: undoless },
  },
  "source.on": {
    doc: "Turns a source kind on, through a source server Oriel found for it in the user's agent.",
    input: object({ kind: sourceKind, server: optional(serverName) }),
    class: {
      kind: "person-only",
      why: "Turning a kind on gives Oriel's sync that source server's tools, so only the user turns one on (decision 0059).",
      inverse: "source.off",
    },
  },
  "source.dismiss-found": {
    doc: "Dismisses the overview's card of what Oriel found in the user's agent.",
    input: object({}),
    class: {
      kind: "person-only",
      why: "What the user wants to see on the overview is theirs to say.",
    },
  },
  // A full sweep: only one finds what was deleted in the source.
  "source.sync": {
    doc: "Syncs a connection into the window.",
    input: object({ connection: connectionId }),
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
  "source.disconnect": {
    doc: "Disconnects a connection: its secret, its options and its items go.",
    input: object({ connection: connectionId }),
    class: {
      kind: "person-only",
      why: "It erases what Oriel read, and the connection's credentials (decision 0049).",
    },
  },
  // The stamp moves on leaving, not opening, so a reload or a glance keeps what changed since they last looked.
  "overview.leave": {
    doc: "Marks what the overview showed as seen, as the user leaves it.",
    input: object({
      seq: refine(number, (n) => Number.isSafeInteger(n) && n >= 0, "expected a change log entry"),
    }),
    class: {
      kind: "person-only",
      why: "What the user has seen is theirs to say: only leaving the overview says it.",
    },
  },
  "noticed.dismiss": {
    doc: "Dismisses a Noticed card until its figures move on.",
    input: object({ signal: noticedSignal }),
    class: { kind: "person-only", why: "What the user wants to see noticed is theirs to say." },
  },
  "noticed.pin": {
    doc: "Pins a Noticed card's block to the overview, as its saved read.",
    input: object({ signal: noticedSignal }),
    class: {
      kind: "person-only",
      why: "In the spike, only the user pins; the pins story opens it.",
    },
  },
  "noticed.unpin": {
    doc: "Removes a pin from the overview.",
    input: object({ pin: refine(string, isUlid, "expected a pin's ID") }),
    class: {
      kind: "person-only",
      why: "In the spike, only the user unpins; the pins story opens it.",
    },
  },
} as const satisfies Record<string, ActionDeclaration>;

export type ActionName = keyof typeof actions;
type Omissible<T> = T extends object
  ? { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] } & {
      [K in keyof T as undefined extends T[K] ? never : K]: T[K];
    }
  : T;
export type ActionInput<N extends ActionName> = Omissible<Infer<(typeof actions)[N]["input"]>>;

export type Call = { [N in ActionName]: { action: N; input: ActionInput<N> } }[ActionName];

export const isInverse = (name: string): name is ActionName =>
  Object.values(actions).some((declared: ActionDeclaration) => declared.class.inverse === name);
