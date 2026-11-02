import type { Actor } from "./actions.ts";
import type { WorkstreamChange, WorkstreamOrigin } from "./workstream.ts";
import type { Instant, SourceKind, Ulid } from "./ids.ts";
import type { HeldSender } from "./thread.ts";
import type { ZoomId } from "./zoom.ts";

// Pilot telemetry, stored locally. Only raw events are stored; these are
// derived from them, never stored:
// - first question asked: the earliest `question.asked`
// - first change set approved, and the time since connect (the onboarding
//   budget): the earliest approving `changeset.decided` minus `source.connected`
// - time to done: from `thread.opened` to the thread's first
//   `changeset.applied` or `thread.marked-done`, whichever came first
// Where the user closed a thread from: its page, or a menu on a list, or a
// swipe on one.
export type CloseVia = "page" | "menu" | "swipe";

// Events that can come from an Oriel action say who acted in `by`, which only
// an actor other than the user fills in; or, by their `cause`, who changed a
// workstream (decision 0024). An Undo's events name, in `undoes`, whose
// action it undid, unless it was the user's own: the agent's, say, from the
// list under its reply.
export type TelemetryEvent = { at: Instant; workspaceId: Ulid } & (
  | { name: "source.connected"; source: SourceKind }
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
  // The thread was marked done, as one over read-only items needs: by the
  // user, on its page, or from a menu or a swipe on a list of threads; or by
  // someone else, who closed nothing in the window.
  | { name: "thread.marked-done"; threadId: Ulid; via?: CloseVia; by?: Actor; undoes?: Actor }
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
  | { name: "zoom.changed"; from: ZoomId; to: ZoomId }
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
  | { name: "review-link.opened"; changeSetId: Ulid }
  // The user opened an item's panel beside the page, by a plain click on a
  // link to it or at an address with one open.
  | { name: "item.panel-opened"; source: SourceKind }
  // The user left Oriel for an item's source: from its panel's button, or by
  // a Cmd/Ctrl or middle click on a link to it.
  | { name: "item.source-opened"; source: SourceKind; via: "panel" | "link" }
  | { name: "escape-hatch.used"; threadId: Ulid; runId: Ulid }
  // The user searched their threads from the sidebar: how long the query was
  // and how many it found, never what it said. One per query the window
  // asked about, once typing paused.
  | { name: "threads.searched"; queryLength: number; results: number }
  // The user opened what a search found: a thread, or a change set in one,
  // and where it was in the list, from 1.
  | { name: "threads.search-opened"; opened: "thread" | "change-set"; rank: number }
  // A call of an Oriel action that no event above counts.
  | { name: "action.called"; action: string; by: Actor; undoes?: Actor }
);
