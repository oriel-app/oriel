import type { ActionName, Actor } from "./actions.ts";
import type { BlockForm } from "./block.ts";
import type { StartQuestion } from "./window-chat.ts";
import type { WorkstreamChange, WorkstreamOrigin } from "./workstream.ts";
import type { Instant, SourceKind, Ulid } from "./ids.ts";
import type { HeldSender } from "./thread.ts";
import type { SketchHeight, SketchRefusal } from "./sketch.ts";
import type { OverviewSection } from "./overview.ts";

// Pilot telemetry, stored locally. Only raw events are stored; these are
// derived from them, never stored:
// - first question asked: the earliest `question.asked`
// - first change set approved, and the time since the first run opened (the
//   onboarding budget, decision 0038): the earliest approving
//   `changeset.decided` minus `first-run.opened`, or on localhost, where
//   there is no first run, minus `source.connected`
// - each phase of the first run: the time between its events, Atlassian's
//   page included, as the gap before `source.connected`
// - time to done: from `thread.opened` to the thread's first
//   `changeset.applied` or `thread.marked-done`, whichever came first
// Where the user closed a thread from: its page, or a menu on a list, or a
// swipe on one.
// Or New chat, in the window chat, which marks the old chat done.
export type CloseVia = "page" | "menu" | "swipe" | "new-chat";

// Events that can come from an Oriel action say who acted in `by`, which only
// an actor other than the user fills in; or, by their `cause`, who changed a
// workstream (decision 0024). An Undo's events name, in `undoes`, whose
// action it undid, unless it was the user's own: the agent's, say, from the
// list under its reply. A source connected says whether it was a `later`
// connection of its kind than the first (decision 0049).
export type TelemetryEvent = { at: Instant; workspaceId: Ulid } & (
  | { name: "source.connected"; source: SourceKind; later: boolean }
  // A connection's options changed, by name, never their values; signed in
  // again, keeping its number and items; or disconnected (decision 0049).
  | { name: "source.configured"; source: SourceKind; later: boolean; options: string[] }
  | { name: "source.signed-in-again"; source: SourceKind; later: boolean }
  | { name: "source.disconnected"; source: SourceKind; later: boolean }
  // The user asked for a sync, and whether it worked.
  | { name: "source.synced"; source: SourceKind; ok: boolean }
  // `size` is how many items it started with.
  | {
      name: "workstream.created";
      workstreamId: Ulid;
      origin: WorkstreamOrigin["kind"];
      size: number;
      by?: Actor;
    }
  // One per item, by whoever added it, as the workstream's log has it: the user,
  // say, or a change set a thread on the workstream applied.
  | {
      name: "workstream.item-added";
      workstreamId: Ulid;
      source: SourceKind;
      cause: WorkstreamChange["cause"]["kind"];
      undoes?: Actor;
    }
  // The workstream was marked done, by the user unless `by` says otherwise,
  // with `threads`, how many of its threads that marked done (decision 0028).
  | {
      name: "workstream.marked-done";
      workstreamId: Ulid;
      threads: number;
      by?: Actor;
      undoes?: Actor;
    }
  // The user deleted the workstream, with `threads`, how many went with it.
  // `kept`: threads used it, so its rows stay, out of sight, for its Undo.
  | {
      name: "workstream.deleted";
      workstreamId: Ulid;
      threads: number;
      kept: boolean;
      undoes?: Actor;
    }
  | { name: "thread.opened"; threadId: Ulid; workstreamId: Ulid; regionSize: number }
  // `rejected`: the message was the reason given for rejecting that change set.
  // `held`: it was a message held from someone else, which the user sent to
  // the agent, as it was or edited (decision 0024).
  | {
      name: "question.asked";
      threadId: Ulid;
      rejected?: Ulid;
      held?: { from: HeldSender["kind"]; edited: boolean };
    }
  // The user discarded a held message, so it never reached the agent.
  | { name: "held-message.discarded"; threadId: Ulid; from: HeldSender["kind"] }
  // A draft the agent made, held for the user, by its action; the user
  // applied it, as drafted or `edited`, or discarded it, `stale` when the
  // options it was drafted over had moved on (decision 0051). Never its
  // input.
  | { name: "draft.made"; threadId: Ulid; action: ActionName }
  | { name: "draft.applied"; threadId: Ulid; action: ActionName; edited: boolean }
  | { name: "draft.discarded"; threadId: Ulid; action: ActionName; stale: boolean }
  // The thread was marked done, as one over read-only items needs: by the
  // user, on its page, or from a menu or a swipe on a list of threads; or by
  // someone else, who closed nothing in the window.
  // `workstreamId`: it was marked done with its workstream, which closed
  // nothing else in the window (decision 0028).
  | {
      name: "thread.marked-done";
      threadId: Ulid;
      via?: CloseVia;
      by?: Actor;
      undoes?: Actor;
      workstreamId?: Ulid;
    }
  // The user deleted the thread. `kept`: it wrote to a source, so its records
  // stay, out of sight. `workstreamRemoved`: its workstream, made for it, went too.
  | {
      name: "thread.deleted";
      threadId: Ulid;
      workstreamId: Ulid;
      kept: boolean;
      workstreamRemoved: boolean;
      via: CloseVia;
    }
  | { name: "grouping.switched"; grouping: string }
  // The user opened a cluster in Browse to its items, or closed it. Stored
  // before OA-153 as `zoom.changed`, which a report maps (SPEC §7).
  | { name: "cluster.opened" }
  | { name: "cluster.closed" }
  | { name: "changeset.edited"; changeSetId: Ulid }
  | {
      name: "changeset.decided";
      changeSetId: Ulid;
      decision: "approved" | "rejected";
      via: "thread" | "review-link";
    }
  // `sources`: the sources it wrote to, in source order (OA-28).
  | { name: "changeset.applied"; changeSetId: Ulid; threadId: Ulid; sources: SourceKind[] }
  // The rest of a change set that started landing, or may have, was dropped.
  // Not a rejection: the person didn't decline it; the source stopped it.
  | { name: "changeset.dismissed"; changeSetId: Ulid; via: "thread" | "review-link" }
  | { name: "changeset.reverted"; changeSetId: Ulid; conflicts: number }
  // An apply went a send's lease with nothing sent or answered (OA-82).
  | { name: "changeset.stalled"; changeSetId: Ulid; threadId: Ulid }
  | { name: "review-link.opened"; changeSetId: Ulid }
  // A live review link whose change set the page won't show: its workstream
  // was deleted (decision 0028). Not an open (OA-143).
  | { name: "review-link.refused"; changeSetId: Ulid; why: "deleted" }
  // The user opened an item's panel beside the page, by a plain click on a
  // link to it or at an address with one open.
  | { name: "item.panel-opened"; source: SourceKind }
  // The user left Oriel for an item's source: from its panel's button, or by
  // a Cmd/Ctrl or middle click on a link to it.
  | { name: "item.source-opened"; source: SourceKind; via: "panel" | "link" }
  | { name: "escape-hatch.used"; threadId: Ulid; runId: Ulid }
  // A block the agent asked for showed under its reply, by its form
  // (decision 0030).
  // A waiting connection's preview shows as a block unasked (decision 0051).
  | { name: "block.shown"; threadId: Ulid; form: BlockForm | "preview" }
  // A block the agent asked for and Oriel refused; the agent was told why.
  | { name: "block.refused"; threadId: Ulid }
  // A sketch the agent wrote showed under its reply, by its height and its
  // size in bytes; or Oriel refused it, by why (decision 0033). Never its
  // text or the names refused.
  | { name: "sketch.shown"; threadId: Ulid; height: SketchHeight; bytes: number }
  | { name: "sketch.refused"; threadId: Ulid; reason: SketchRefusal }
  // Release slices the agent proposed showed under its reply, by how many;
  // or Oriel refused them (the scope-lab spike). The person made a change
  // set of one, by how many items it defers and whether they toggled any.
  | { name: "slices.shown"; threadId: Ulid; count: number }
  | { name: "slices.refused"; threadId: Ulid }
  | { name: "slices.cut"; threadId: Ulid; deferred: number; toggled: boolean }
  // An answer named IDs as chips that Oriel couldn't resolve, `count` of
  // them, which drew as "unknown reference" (decision 0032).
  | { name: "chip.unknown"; threadId: Ulid; count: number }
  // The window chat (decision 0027): its first question made it; New chat
  // left it, `kept` working when something in it waits on the user.
  | { name: "window-chat.opened"; threadId: Ulid }
  | { name: "window-chat.new-chat"; threadId: Ulid; kept: boolean }
  // The user asked one of the questions to start from, by its kind.
  | { name: "window-chat.question-used"; question: StartQuestion }
  // The user searched their threads from the sidebar: how long the query was
  // and how many it found, never what it said. One per query the window
  // asked about, once typing paused.
  | { name: "threads.searched"; queryLength: number; results: number }
  // The user opened what a search found: a thread, or a change set in one,
  // and where it was in the list, from 1.
  | { name: "threads.search-opened"; opened: "thread" | "change-set"; rank: number }
  // The user searched items in Browse: how long the query was and how many
  // items it found, never what it said. One per query Browse loaded.
  | { name: "items.searched"; queryLength: number; results: number }
  // The user opened the overview, the window's first view (decision 0027).
  | { name: "overview.opened" }
  // The user opened a section's "more": in place, or in Browse filtered to
  // that slice.
  | { name: "overview.more-opened"; section: OverviewSection }
  // A cluster Not in a workstream yet suggested became a workstream, by
  // Make a workstream there; `grouping` is the cluster's.
  | { name: "overview.suggestion-made"; workstreamId: Ulid; grouping: string }
  // The person picked a theme in Settings, by its name (decision 0034).
  | { name: "theme.picked"; theme: string }
  // The desktop app's first run (decision 0038). Its first screen opened,
  // which starts the onboarding budget's clock; `fresh`: on a data folder
  // with nothing in it yet.
  | { name: "first-run.opened"; fresh: boolean }
  // What the first run found of each command-line agent, by its state.
  | { name: "first-run.cli-found"; cli: "claude-code" | "codex"; state: string }
  // An install, sign-in or update of the person's CLI started, from the
  // first run or Settings, and how it ended, after how long. `cli`: which,
  // since Codex's sign-in (decision 0048); an event without it was Claude
  // Code's.
  | {
      name: "cli.started";
      command: "install" | "sign-in" | "update";
      cli?: "claude-code" | "codex";
    }
  | {
      name: "cli.ended";
      command: "install" | "sign-in" | "update";
      outcome: "done" | "failed" | "cancelled";
      ms: number;
      cli?: "claude-code" | "codex";
    }
  // The test turn that proves the plan answers: how long, its tokens, and
  // why it failed if it did, on which CLI, as above.
  | {
      name: "first-run.test-turn";
      ms: number;
      inputTokens: number;
      outputTokens: number;
      failed?: string;
      cli?: "claude-code" | "codex";
    }
  | { name: "first-run.ai-chosen"; ai: "claude-code" | "codex" | "api" }
  | { name: "first-run.step-skipped"; step: "ai" | "work" }
  // Show details' log was copied, for someone helping the person.
  | { name: "first-run.details-copied"; what: string }
  // The first run ended: how long from its opening, and whether it installed
  // or signed in the person's CLI.
  | { name: "first-run.finished"; ms: number; installed: boolean; signedIn: boolean }
  // A call of an Oriel action that no event above counts.
  | { name: "action.called"; action: string; by: Actor; undoes?: Actor }
);
