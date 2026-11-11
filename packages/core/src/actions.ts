// Oriel's own actions (decision 0024): everything that changes Oriel's data,
// each declared once, here, where bindings can read it without importing the
// server. A declaration is its name (its key below), its input as a validator
// that describes itself, a one-line doc, its class and its inverse, and why
// any door is closed to it. The server holds the handlers and the one
// dispatcher every door calls. Source writes stay in their source's
// catalogue (decision 0019); they aren't declared again here.
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

// Who acted, recorded with every call: the user, in the window; the agent in
// a thread; an outside tool, by the name the user gave it when they
// connected it, never what it says of itself (decision 0058); whoever holds
// a review link, by the name they typed; a change set, for what follows its
// apply; or a source's sync, for what follows it.
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
// why. Person only: never the agent's or a tool's, and says why; one may
// have an inverse, a person's too, as rejecting a change set has (OA-258).
export type ActionClass =
  | { kind: "direct"; inverse: string }
  | { kind: "direct"; inverse: null; why: string }
  | { kind: "person-only"; why: string; inverse?: string };

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
  // Closed to the agent, it may still draft it: write out its input for the
  // user, who applies it, edits it or discards it (decision 0051). Only a
  // direct action closed to the agent may be, never a person's, such as one
  // that holds credentials. `window`: drafted in the window chat's module
  // always; a source's only while a connection waits, or one reads in its
  // connector's own form.
  draftable?: true | "window";
};

export const maxNameChars = 120;
export const maxItems = 500;
export const maxMessageChars = 8_000;
// Why a review link's holder rejected a change set: they control it, and it
// waits in the thread for the user, so it is shorter than a message.
export const maxReasonChars = 2_000;

// A Noticed card's signal, by its ID: `<kind>:<subject's ID>`.
const noticedSignal = refine(
  string,
  (id) => id.length > 0 && id.length <= 200,
  "expected a signal's ID",
);
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
// Where in the window the user closed a thread from: its page, a list's menu
// or swipe, or New chat or Continue in the window chat (decision 0027).
export const closeVia = optional(
  union(
    literal("page"),
    literal("menu"),
    literal("swipe"),
    literal("new-chat"),
    literal("continue"),
  ),
);
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
// What an outside tool is called: the name the user gave it when they
// connected it, which the window and every record show (decision 0058).
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
// A connection, by the ID the server made for it: the page only names one
// the server has.
const connectionId = refine(string, isUlid, "expected a connection ID", { type: "ConnectionId" });
// A connector, by its kind: a short lowercase word, as core's ID shape has it.
const sourceKind = refine(
  string,
  (kind) => isPrefix(kind) && !kind.includes("."),
  "expected a kind",
);
// A source server, by its name in the person's agent.
const serverName = refine(
  string,
  (name) => name.trim() !== "" && name.length <= 200,
  "expected a source server's name",
);
// What configuring a connection is to the agent and outside tools: they may
// draft it, but only the user applies it (decisions 0049, 0051).
const configures =
  "How a connection reads its source is the user's to set: the agent may draft it, but only the user applies it (decision 0049).";
// A review link's token, which its holder presents.
const token = optional(string);
// Approval is a person's (decision 0003): what each change set action says.
const approval = "Approval is a person's, in the thread or through a review link (decision 0003).";
// Who starts a second look at a change set (decision 0054).
const secondLook =
  "A second look is a model call the person asks for, on what an agent proposed: an agent doesn't ask for one of its own work, and an outside tool's words start no model call (decision 0054).";
// Opening a thread and saying something in one, which the agent may not yet.
const unsaid =
  "Text the agent writes must show where it came from before it reaches a thread, or it would read as the user's words (decision 0024).";
// An outside tool's words in a thread, which OA-73 opens (decision 0058).
const untold = "An outside tool's words in a thread are held for the user, which OA-73 builds.";
// An action is offered to outside tools only once their call shows in the
// window as theirs, with its Undo (decision 0058): so far, a workstream's
// adds and removes.
const undoless =
  "An outside tool's call of it doesn't yet show in the window as the tool's, with Undo (decision 0058).";
// Deleting a workstream and bringing it back, which only the user may.
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
    // From a cluster of the window, from picked items, or empty, for a
    // thread started from nothing, under the name the user gave it there.
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
    // `oriel`: the name is Oriel's, as it was before the user's rename this
    // undoes, so Oriel may name the workstream again. Only the user's Undo says so.
    input: object({ workstream: workstreamId, name, oriel: optional(literal(true)) }),
    class: { kind: "direct", inverse: "workstream.rename" },
    userOnly: { oriel: "Only the user's Undo gives a workstream's name back to Oriel." },
    closed: { tool: undoless },
  },
  // Marking done marks its open threads done too, and reopening reopens
  // only those (decision 0028). `mark`: only the mark made then, so an Undo
  // never takes off a later one.
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
  // One no thread ever used goes with its log, and has no Undo: making a
  // workstream undoes as that. One threads use is hidden with them, and
  // restored by its Undo (decision 0028). `threads`: how many the user was
  // told go with it, so a thread opened since never goes unseen; none
  // without it.
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
    closed: { tool: undoless },
  },
  // New chat in the window chat (decision 0027): the window shows a fresh
  // chat from the next question on. The old one is marked done as the
  // user's action, unless a change set or a held message in it waits on
  // them: then it stays working, in Needs you.
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
  // Open as a thread (OA-355): the window chat goes on as its workstream's
  // ordinary thread, as it does once that workstream gains a member
  // (OA-347), and the window starts a fresh chat from the next question on.
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
  // Continue in… (decision 0027, amended by 0062): the window chat changes
  // no item, so a request to change one goes on in a thread on the item's
  // workstream, or on a new one named for it, with the request sent there
  // as the user's message, about the item. `seq`: that message in the
  // window chat, which Oriel fills in as it holds the agent's draft.
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
  // The user's message, which starts a turn to answer it, with the items
  // it is about, open beside the composer as they sent it (decision 0062).
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
  // Try again, under a turn that failed before the agent did anything: the
  // same message, answered again.
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
  // Sync now, in a thread's right rail: the thread catches up with its
  // workstream as the user's next message would make it, with its marker,
  // without one (decision 0018).
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
    doc: "Discards a message held in a thread, from anyone but the user, so the agent never sees it, or a draft, so it never applies. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq }),
    class: {
      kind: "person-only",
      why: "Whether the agent hears words from outside the thread is the user's call.",
    },
  },
  // A draft is held as a held message is (decision 0051): the user applies
  // it, as it is or as `edit` changes its input, or discards it with
  // `held.discard`. Applying calls the drafted action as the user.
  "held.apply": {
    doc: "Applies a draft held in a thread, as it is, or with `edit`, the user's changes to its input. `seq` is its place in the thread's chat.",
    input: object({ thread: threadId, seq, edit: optional(record(unknown)) }),
    class: {
      kind: "person-only",
      why: "A draft is the agent's suggestion of the user's own action, so only the user applies it, in the window (decision 0051).",
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
  // held in the thread for the user (decision 0024). In the thread, its Undo
  // puts it back to awaiting review (OA-258).
  "changeset.reject": {
    doc: "Rejects a change set; a review link's holder says why.",
    input: object({ changeSet: changeSetId, hash: string, reason: optional(messageText), token }),
    class: { kind: "person-only", why: approval, inverse: "changeset.unreject" },
    reviewLink: true,
  },
  // Rejecting's Undo, in the thread only: the change set awaits review again,
  // as it was, with its second look. `decision`: the rejection it takes
  // back, so an Undo never takes back a later one.
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
  // A second look at a change set (decision 0054): Oriel's own run, only
  // when the person asks, first or again once the last went stale or
  // failed; and a change it suggested, which the person adds.
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
  // The look's head says it's the agent's reading; while it shows, the
  // change set offers only what pertains to it, so Dismiss gives back
  // Approve and Reject (OA-257).
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
  // `places`: the suggestions to add, by place: one, or all not yet added.
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
  // A connection's steps, by its connector (decision 0049): what the user
  // gave across them, which the connector's own validator checks, as the
  // composition root supplies it, since core keeps no connector's types.
  // A person's own edit of a stand-in's item in its panel (decision 0059):
  // the fields its form gives, by name, which its connection checks. Its
  // Undo sets back what they were. The agent's writes to a source are change
  // sets, and only the person approves one: this is the one way a source's
  // item changes without, and only from the person's own hand.
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
  // A connection's options, merged over the ones it has, which its
  // connector's validator checks, as for `source.connect`. Its Undo puts back
  // the ones it replaced.
  "source.configure": {
    doc: "Sets a connection's options, which its next sync reads with.",
    input: object({ connection: connectionId, options: unknown }),
    class: { kind: "direct", inverse: "source.configure" },
    closed: { agent: configures, tool: configures },
    draftable: true,
  },
  // A kind turned off or on (decision 0059). Off, its items and every
  // surface of it stop showing, and its items stay in the index for when
  // it's on again. On, through a source server Oriel found for it, Oriel's
  // sync gets that server's read tools, so only a person turns one on; the
  // agent may turn one off, with Undo, as when the user asks to stop seeing
  // a source. Turning one on with no server names none: it was off by
  // choice, and its connection reads it again.
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
  // The overview's card of source servers found or gone, dismissed: it
  // shows again only for another change.
  "source.dismiss-found": {
    doc: "Dismisses the overview's card of what Oriel found in the user's agent.",
    input: object({}),
    class: {
      kind: "person-only",
      why: "What the user wants to see on the overview is theirs to say.",
    },
  },
  // What the user asks for: a full sweep, as only one finds what was
  // deleted in the source.
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
  // The last-seen stamp moves when the user leaves the overview, not when
  // they open it, so a reload or a glance keeps what changed since they last
  // looked (decision 0027).
  // `seq`: the last change log entry the overview showed; what committed
  // after it stays unseen.
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
  // Noticed (decision 0052): a card dismissed, or its
  // block pinned to the overview as a saved read (decision 0030), and a pin
  // removed. Person-only, and named for Noticed: 0030's `pin.add` and
  // `pin.remove`, direct, with Undo, for the agent too, are the pins story's.
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
  Object.values(actions).some((declared: ActionDeclaration) => declared.class.inverse === name);
