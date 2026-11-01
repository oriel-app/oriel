import type { Actor } from "./actions.ts";
import type { GroupChange, GroupOrigin } from "./group.ts";
import type { Instant, SourceKind, Ulid } from "./ids.ts";
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
// group (decision 0024).
export type TelemetryEvent = { at: Instant; workspaceId: Ulid } & (
  | { name: "source.connected"; source: SourceKind }
  // The user asked for a sync, and whether it worked.
  | { name: "source.synced"; source: SourceKind; ok: boolean }
  // `size` is how many items it started with.
  | {
      name: "group.created";
      groupId: Ulid;
      origin: GroupOrigin["kind"];
      size: number;
      by?: Actor;
    }
  // One per item, by whoever added it, as the group's log has it: the user,
  // say, or a change set a thread on the group applied.
  | {
      name: "group.item-added";
      groupId: Ulid;
      source: SourceKind;
      cause: GroupChange["cause"]["kind"];
    }
  | { name: "thread.opened"; threadId: Ulid; groupId: Ulid; regionSize: number }
  // `rejected`: the message was the reason given for rejecting that change set.
  | { name: "question.asked"; threadId: Ulid; rejected?: Ulid }
  // The thread was marked done, as one over read-only items needs: by the
  // user, on its page, or from a menu or a swipe on a list of threads.
  | { name: "thread.marked-done"; threadId: Ulid; via: CloseVia; by?: Actor }
  // The user deleted the thread. `kept`: it wrote to a source, so its records
  // stay, out of sight. `groupRemoved`: its group, made for it, went too.
  | {
      name: "thread.deleted";
      threadId: Ulid;
      groupId: Ulid;
      kept: boolean;
      groupRemoved: boolean;
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
  | { name: "changeset.applied"; changeSetId: Ulid; threadId: Ulid }
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
  // A call of an Oriel action that no event above counts.
  | { name: "action.called"; action: string; by: Actor }
);
