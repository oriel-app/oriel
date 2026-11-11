// Effects as data, for every page: requests to our own server, tagged with
// what they're for, and the few things that touch the address bar or the
// thread's event stream. `perform` (effects.ts) carries them out; updates
// return them, so they're tested without a DOM.
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";
import type { BrowseFilter, GroupingId, TextSize, UndoView } from "./view.ts";
import type { Ending } from "./ending.ts";
import type { OverviewSection } from "@oriel/core/overview";
import type { StartQuestion } from "@oriel/core/window-chat";

export type Tag =
  | { kind: "workstreams" }
  | { kind: "createWorkstream" }
  | { kind: "addToWorkstream"; workstreamId: string }
  | { kind: "dropped"; workstreamId: string }
  | { kind: "workstream"; id: string }
  | { kind: "workstreamChanged"; id: string }
  // A removal was undone, through the call the server gave for it.
  | { kind: "restored"; id: string }
  // The workstream loaded again after a sync: only its view changes.
  | { kind: "workstreamSynced"; id: string }
  | { kind: "renamed"; id: string }
  // The workstream was marked done, reopened or deleted, or one of those
  // undone (decision 0028).
  | { kind: "ended"; id: string; how: Ending["kind"] | "undone"; name: string }
  | { kind: "threadOpened"; workstreamId: string }
  // An item moved by a drag or its row's menu (moving.ts): it joined, or a
  // new workstream was made of it; it left where it came from; or one of
  // those undone.
  | { kind: "moveJoined" }
  | { kind: "moveLeft" }
  | { kind: "moveUndone"; action: string }
  | { kind: "threadStarted"; draft: number }
  // `statuses`: how many statuses the thread's stream had sent when it was
  // asked for, when any had.
  | { kind: "thread"; id: string; statuses?: number }
  | { kind: "sent"; threadId: string }
  | { kind: "threadAction"; threadId: string }
  // `statuses`, as a thread's load has it.
  | { kind: "synced"; threadId: string; statuses: number }
  | { kind: "diff"; changeSetId: string }
  | { kind: "changeSet"; threadId: string; changeSetId: string }
  // A second look asked for (decision 0054): apart from the change set's
  // own requests, since approving never waits on one.
  | { kind: "secondLook"; threadId: string; changeSetId: string }
  | { kind: "lookDismissed"; threadId: string; changeSetId: string; look: string }
  // A rejection's Undo, from the bead (OA-258).
  | { kind: "unrejected"; changeSetId: string }
  | { kind: "held"; threadId: string; seq: number }
  // A draft applied, or that undone, by its place in the thread (decision 0051).
  | { kind: "draftApplied"; threadId: string; seq: number }
  | { kind: "draftUndone"; threadId: string; seq: number }
  // A line under the agent's reply was undone, or done again.
  | { kind: "lineUndone"; threadId: string; seq: number; index: number }
  | { kind: "reviewLink"; changeSetId: string }
  | { kind: "threads" }
  | { kind: "markedDone"; threadId: string }
  | { kind: "deletion"; threadId: string }
  | { kind: "deleted"; threadId: string }
  | { kind: "reviewOpened" }
  | { kind: "reviewDecided" }
  | { kind: "telemetry" }
  // The overview, and the user leaving it, which marks what it showed seen.
  | { kind: "overview" }
  | { kind: "overviewLeft" }
  // Noticed's strip, and a card's or a pin's action.
  | { kind: "noticed" }
  | { kind: "noticedChanged" }
  // A workstream made from a candidate on the overview, by its key there,
  // and that undone.
  | { kind: "overviewMade"; key: string; grouping: GroupingId }
  | { kind: "overviewUnmade"; key: string }
  // Which window chat the window shows; a question asked in it; New chat.
  | { kind: "windowChat" }
  | { kind: "windowChatAsked" }
  | { kind: "windowChatNew" }
  // The sidebar's search, by the query it asked about.
  | { kind: "search"; request: number }
  // An item read for the panel, and when the index last saw it change.
  | { kind: "item"; id: string }
  // The panel's item added to the current workstream, or that undone.
  | { kind: "panelAdded"; id: string; workstreamId: string; name: string }
  | { kind: "panelAddUndone"; id: string; workstreamId: string }
  // A stand-in's item edited in the panel, by its key, or that undone.
  | { kind: "panelEdited"; id: string; key: string }
  | { kind: "panelEditUndone"; id: string }
  // A workstream the panel added an item to, loaded again to see whether
  // the add still stands.
  | { kind: "panelAddChecked"; workstreamId: string }
  | { kind: "itemStamp"; id: string }
  // Every connection, as the server lists them.
  | { kind: "connections" }
  // A connector's steps: the folder picker, and the connection made, by the
  // connector's kind.
  | { kind: "connectPicked"; of: string }
  | { kind: "connected"; of: string }
  // A connection's onboarding turn started; its review step read, and its
  // draft or Oriel's guess applied.
  | { kind: "onboarded"; of: string; connection: string }
  | { kind: "reviewed"; of: string; connection: string; tab?: string }
  | { kind: "orielAsked"; connection: string }
  | { kind: "reviewApplied"; of: string; connection: string; beside?: string }
  | { kind: "reviewRedrawn"; connection: string }
  // In Settings, by a connection's ID: its options set, or that undone; the
  // list one of its picks lists; and it disconnected.
  | { kind: "configured"; connection: string }
  | { kind: "configureUndone"; connection: string }
  | { kind: "connectionChoices"; connection: string }
  | { kind: "disconnected"; connection: string }
  // How every connector shows, from its declaration.
  | { kind: "connectors" }
  // A connection synced on demand, by its ID.
  | { kind: "sourceSynced"; connection: string }
  // A kind turned on or off from Settings, the overview's card or the first
  // run (decision 0059), and how often sync runs set.
  | { kind: "kindSwitched"; of: string }
  | { kind: "serversSync" }
  // Settings, loaded, changed, or looked for again (OA-181).
  | { kind: "settings" }
  | { kind: "settingsChanged" }
  | { kind: "settingsLooked" }
  // How much of the plan Oriel has used, under each CLI's row.
  | { kind: "settingsUsage" }
  // The desktop app's first run and its commands for the person's CLI
  // (decision 0038): loaded, a command, the AI chosen, and a step.
  | { kind: "setup" }
  | { kind: "setupCli" }
  | { kind: "setupAi" }
  | { kind: "setupProgress"; did: string };

export type Effect =
  // Browse under a grouping, and its filters when any is set.
  | { type: "loadWindow"; request: number; grouping: GroupingId; filter?: BrowseFilter }
  // A page of a cluster's items, from the `from`th, of those the filters keep.
  | {
      type: "loadItems";
      request: number;
      grouping: GroupingId;
      cluster: string;
      from: number;
      filter?: BrowseFilter;
    }
  // Puts the grouping in the address bar, so a reload keeps it.
  | { type: "showGrouping"; grouping: GroupingId }
  // Puts Browse's filters in the address bar, in place of those there.
  | { type: "showFilter"; filter: BrowseFilter }
  | { type: "http"; method: "GET" | "POST"; url: string; body?: unknown; tag: Tag }
  // Goes to another page, as a link would, and adds it to history, or with
  // `replace`, takes the current page's place in it. `stay`: the page stays
  // where it is scrolled, as when only the panel beside it changes.
  | { type: "navigate"; route: Route; replace?: true; stay?: true }
  // Scrolls a thread's page to its latest entry.
  | { type: "showLatest" }
  // Scrolls a thread's page to one of its change sets, at the top, and
  // puts focus on its heading. `smooth`: it glides there, unless the person
  // asked for reduced motion.
  | { type: "showChangeSet"; changeSetId: string; smooth?: true }
  // Puts the cursor in a thread's message box, as after Reject, so what
  // was wrong is the user's next message.
  | { type: "focusComposer" }
  // Puts focus on a change set's Show once it has folded itself, if focus
  // was inside it or dropped to the page, as when its Approve went.
  | { type: "focusFolded"; changeSetId: string }
  // Puts focus on a thread's heading, once the page shows it, as after the
  // page moved on from an approval, so a screen reader starts there.
  | { type: "focusHeading" }
  // Watches a thread's events after `after`; one thread at a time.
  | { type: "subscribe"; threadId: string; after: number }
  | { type: "unsubscribe" }
  // Watch every thread for a move, from any page but a thread's, whose own
  // stream says, or a review link's.
  | { type: "watchThreads" }
  | { type: "unwatchThreads" }
  | { type: "copy"; text: string }
  // Sends `msg` once `ms` have passed, as when an undo runs out.
  | { type: "after"; ms: number; msg: Msg }
  // Sends `msg` once the page shows the update that asked, before it paints,
  // and after what the user did meanwhile.
  | { type: "rendered"; msg: Msg }
  // Puts the person's theme and text size on the page's <html>, as the
  // server does for the first paint (decision 0034).
  | { type: "showLook"; theme: string; textSize: TextSize };

// A server's reply to an `http` effect. `body` is our own server's JSON in
// the shape @oriel/web/view declares for that route, or `{ error }`.
export type Replied = { type: "replied"; tag: Tag; ok: boolean; body: unknown };

export const get = (url: string, tag: Tag): Effect => ({ type: "http", method: "GET", url, tag });
export const post = (url: string, body: unknown, tag: Tag): Effect => ({
  type: "http",
  method: "POST",
  url,
  body,
  tag,
});

// An Undo, sent back as the server gave it, to the one path every Undo takes
// (decision 0024). `line`: the line under the agent's reply it is from, by
// its thread, its list's place in the chat and its own in the list, which
// then says what came of it.
export function undoing(
  undo: UndoView,
  tag: Tag,
  line?: { thread: string; seq: number; index: number },
): Effect {
  const at = line
    ? `?${new URLSearchParams({ thread: line.thread, seq: `${line.seq}`, line: `${line.index}` })}`
    : "";
  return post(`/api/actions/${undo.action}${at}`, undo.input, tag);
}

// Pilot telemetry only the page knows happened, as the server takes it.
export type Report =
  | { name: "grouping.switched"; grouping: GroupingId }
  | { name: "cluster.opened" }
  | { name: "cluster.closed" }
  | { name: "item.panel-opened"; item: string }
  | { name: "item.source-opened"; item: string; via: "panel" | "link" }
  | { name: "item.asked-about"; item: string }
  | { name: "threads.searched"; queryLength: number; results: number }
  | { name: "threads.search-opened"; opened: "thread" | "change-set"; rank: number }
  | { name: "items.searched"; queryLength: number; results: number }
  | { name: "overview.opened" }
  | { name: "block.regrouped" }
  | { name: "overview.more-opened"; section: OverviewSection }
  | { name: "overview.suggestion-made"; workstreamId: string; grouping: GroupingId }
  | { name: "window-chat.question-used"; question: StartQuestion }
  | {
      name: "first-run.details-copied";
      // A command, or a connector's first sync that stopped, by its kind.
      what: string;
    };

// Best effort: its reply changes nothing.
export const report = (event: Report): Effect =>
  post("/api/telemetry", event, { kind: "telemetry" });

// What a request that never reached Oriel says, as while it restarts. A load
// that works once it's back takes it back: what the request did, if anything,
// shows on the page that loaded.
export const unreachable = "Oriel can't be reached. Is it still running?";
export const reached = (notice: string | null): string | null =>
  notice === unreachable ? null : notice;

// What a failed reply says, for the person.
export function errorOf(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  )
    return body.error;
  return "Something went wrong. Try again.";
}
