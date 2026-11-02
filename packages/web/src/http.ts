// Effects as data, for every page: requests to our own server, tagged with
// what they're for, and the few things that touch the address bar or the
// thread's event stream. `perform` (effects.ts) carries them out; updates
// return them, so they're tested without a DOM.
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";
import type { GroupingId, UndoView } from "./view.ts";

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
  | { kind: "threadOpened"; workstreamId: string }
  | { kind: "threadStarted"; draft: number }
  // `statuses`: how many statuses the thread's stream had sent when it was
  // asked for, when any had.
  | { kind: "thread"; id: string; statuses?: number }
  | { kind: "sent"; threadId: string }
  | { kind: "threadAction"; threadId: string }
  | { kind: "diff"; changeSetId: string }
  | { kind: "changeSet"; threadId: string; changeSetId: string }
  | { kind: "held"; threadId: string; seq: number }
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
  // The sidebar's search, by the query it asked about.
  | { kind: "search"; request: number }
  // An item read for the panel, and when the index last saw it change.
  | { kind: "item"; id: string }
  | { kind: "itemStamp"; id: string }
  | { kind: "folder" }
  | { kind: "folderConnected" }
  | { kind: "folderSynced" }
  | { kind: "jira" }
  | { kind: "jiraConnected" }
  | { kind: "jiraSynced" };

export type Effect =
  | { type: "loadWindow"; request: number; grouping: GroupingId }
  // Puts the grouping in the address bar, so a reload keeps it.
  | { type: "showGrouping"; grouping: GroupingId }
  | { type: "http"; method: "GET" | "POST"; url: string; body?: unknown; tag: Tag }
  // Goes to another page, as a link would, and adds it to history, or with
  // `replace`, takes the current page's place in it. `stay`: the page stays
  // where it is scrolled, as when only the panel beside it changes.
  | { type: "navigate"; route: Route; replace?: true; stay?: true }
  // Scrolls a thread's page to its latest entry.
  | { type: "showLatest" }
  // Scrolls a thread's page to one of its change sets, at the top.
  | { type: "showChangeSet"; changeSetId: string }
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
  | { type: "rendered"; msg: Msg };

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
  | { name: "zoom.changed"; from: "cluster" | "list"; to: "cluster" | "list" }
  | { name: "item.panel-opened"; item: string }
  | { name: "item.source-opened"; item: string; via: "panel" | "link" }
  | { name: "threads.searched"; queryLength: number; results: number }
  | { name: "threads.search-opened"; opened: "thread" | "change-set"; rank: number };

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
