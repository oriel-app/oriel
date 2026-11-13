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
  | { kind: "restored"; id: string }
  | { kind: "workstreamSynced"; id: string }
  | { kind: "renamed"; id: string }
  | { kind: "ended"; id: string; how: Ending["kind"] | "undone"; name: string }
  | { kind: "threadOpened"; workstreamId: string }
  | { kind: "moveJoined" }
  | { kind: "moveLeft" }
  | { kind: "moveUndone"; action: string }
  | { kind: "threadStarted"; draft: number }
  | { kind: "thread"; id: string; statuses?: number }
  | { kind: "sent"; threadId: string }
  | { kind: "retried"; threadId: string }
  | { kind: "threadAction"; threadId: string }
  | { kind: "synced"; threadId: string; statuses: number }
  | { kind: "diff"; changeSetId: string; stored?: true }
  | { kind: "changeSet"; threadId: string; changeSetId: string }
  // Apart from the change set's own requests, since approving never waits on one.
  | { kind: "secondLook"; threadId: string; changeSetId: string }
  | { kind: "lookDismissed"; threadId: string; changeSetId: string; look: string }
  | { kind: "unrejected"; changeSetId: string }
  | { kind: "held"; threadId: string; seq: number }
  | { kind: "draftApplied"; threadId: string; seq: number }
  | { kind: "draftUndone"; threadId: string; seq: number }
  | { kind: "continued"; threadId: string; seq: number }
  | { kind: "lineUndone"; threadId: string; seq: number; index: number }
  | { kind: "reviewLink"; changeSetId: string }
  | { kind: "threads" }
  | { kind: "markedDone"; threadId: string }
  | { kind: "deletion"; threadId: string }
  | { kind: "deleted"; threadId: string }
  | { kind: "reviewOpened" }
  | { kind: "reviewDecided" }
  | { kind: "telemetry" }
  | { kind: "overview" }
  | { kind: "overviewLeft" }
  | { kind: "noticed" }
  | { kind: "noticedChanged" }
  | { kind: "overviewMade"; key: string; grouping: GroupingId }
  | { kind: "overviewUnmade"; key: string }
  | { kind: "windowChat" }
  | { kind: "windowChatAsked" }
  | { kind: "windowChatNew" }
  | { kind: "windowChatOpened" }
  | { kind: "search"; request: number }
  | { kind: "item"; id: string }
  | { kind: "panelAdded"; id: string; workstreamId: string; name: string }
  | { kind: "panelAddUndone"; id: string; workstreamId: string }
  | { kind: "panelEdited"; id: string; key: string }
  | { kind: "panelEditUndone"; id: string }
  | { kind: "panelAddChecked"; workstreamId: string }
  | { kind: "itemStamp"; id: string }
  | { kind: "connections" }
  | { kind: "connectPicked"; of: string }
  | { kind: "connected"; of: string }
  | { kind: "onboarded"; of: string; connection: string }
  | { kind: "reviewed"; of: string; connection: string; tab?: string }
  | { kind: "orielAsked"; connection: string }
  | { kind: "reviewApplied"; of: string; connection: string; beside?: string }
  | { kind: "reviewRedrawn"; connection: string }
  | { kind: "configured"; connection: string }
  | { kind: "configureUndone"; connection: string }
  | { kind: "connectionChoices"; connection: string }
  | { kind: "disconnected"; connection: string }
  | { kind: "connectors" }
  | { kind: "sourceSynced"; connection: string }
  | { kind: "kindSwitched"; of: string }
  | { kind: "serversSync" }
  | { kind: "settings" }
  | { kind: "settingsChanged" }
  | { kind: "settingsLooked" }
  | { kind: "settingsUsage" }
  | { kind: "setup" }
  | { kind: "setupCli" }
  | { kind: "setupAi" }
  | { kind: "setupProgress"; did: string };

export type Effect =
  | { type: "loadWindow"; request: number; grouping: GroupingId; filter?: BrowseFilter }
  | {
      type: "loadItems";
      request: number;
      grouping: GroupingId;
      cluster: string;
      from: number;
      filter?: BrowseFilter;
    }
  | { type: "showGrouping"; grouping: GroupingId }
  | { type: "showFilter"; filter: BrowseFilter }
  | { type: "http"; method: "GET" | "POST"; url: string; body?: unknown; tag: Tag }
  | { type: "navigate"; route: Route; replace?: true; stay?: true }
  | { type: "showLatest"; smooth?: true }
  | { type: "showChangeSet"; changeSetId: string; smooth?: true }
  | { type: "focusComposer" }
  | { type: "focusFolded"; changeSetId: string }
  | { type: "focusHeading" }
  | { type: "subscribe"; threadId: string; after: number }
  | { type: "unsubscribe" }
  | { type: "watchThreads" }
  | { type: "unwatchThreads" }
  | { type: "copy"; text: string }
  | { type: "after"; ms: number; msg: Msg }
  // Sends `msg` once the page shows the update that asked, before it paints.
  | { type: "rendered"; msg: Msg }
  | { type: "showLook"; theme: string; textSize: TextSize };

export type Replied = { type: "replied"; tag: Tag; ok: boolean; body: unknown };

export const get = (url: string, tag: Tag): Effect => ({ type: "http", method: "GET", url, tag });
export const post = (url: string, body: unknown, tag: Tag): Effect => ({
  type: "http",
  method: "POST",
  url,
  body,
  tag,
});

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

export type Report =
  | { name: "grouping.switched"; grouping: GroupingId }
  | { name: "cluster.opened" }
  | { name: "cluster.closed" }
  | { name: "item.panel-opened"; item: string }
  | { name: "item.source-opened"; item: string; via: "panel" | "link" }
  | { name: "item.asked-about"; item: string }
  | { name: "item.dropped-on-composer"; item: string }
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
      what: string;
    };

// Best effort: its reply changes nothing.
export const report = (event: Report): Effect =>
  post("/api/telemetry", event, { kind: "telemetry" });

export const unreachable = "Oriel can't be reached. Is it still running?";
export const reached = (notice: string | null): string | null =>
  notice?.endsWith(unreachable) ? null : notice;

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
