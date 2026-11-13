import type { ActionName, Actor } from "./actions.ts";
import type { BlockForm } from "./block.ts";
import type { FindingKind } from "./challenge.ts";
import type { StartQuestion } from "./window-chat.ts";
import type { WorkstreamChange, WorkstreamOrigin } from "./workstream.ts";
import type { Instant, SourceKind, Ulid } from "./ids.ts";
import type { HeldSender } from "./thread.ts";
import type { SketchHeight, SketchRefusal } from "./sketch.ts";
import type { OverviewSection } from "./overview.ts";
import type { SignalKind } from "./noticed.ts";

export type CloseVia = "page" | "menu" | "swipe" | "new-chat" | "continue";

export type TelemetryEvent = { at: Instant; workspaceId: Ulid } & (
  | { name: "source.connected"; source: SourceKind; later: boolean }
  // Option names only, never their values.
  | { name: "source.configured"; source: SourceKind; later: boolean; options: string[] }
  | { name: "source.disconnected"; source: SourceKind; later: boolean }
  | { name: "source.synced"; source: SourceKind; ok: boolean }
  // Never a title, the server's name or its address.
  | {
      name: "source.server-synced";
      source: SourceKind;
      agent: "claude-code" | "codex";
      items: number;
      ms: number;
      ok: boolean;
    }
  // The kind only, never the source server's name or address.
  | {
      name: "source.turned";
      source: SourceKind;
      on: boolean;
      by: "person" | "agent";
      undoes?: Actor;
    }
  | {
      name: "workstream.created";
      workstreamId: Ulid;
      origin: WorkstreamOrigin["kind"];
      size: number;
      by?: Actor;
    }
  | {
      name: "workstream.item-added";
      workstreamId: Ulid;
      source: SourceKind;
      cause: WorkstreamChange["cause"]["kind"];
      undoes?: Actor;
    }
  | {
      name: "workstream.marked-done";
      workstreamId: Ulid;
      threads: number;
      by?: Actor;
      undoes?: Actor;
    }
  | {
      name: "workstream.deleted";
      workstreamId: Ulid;
      threads: number;
      kept: boolean;
      undoes?: Actor;
    }
  | { name: "thread.opened"; threadId: Ulid; workstreamId: Ulid; regionSize: number }
  | {
      name: "question.asked";
      threadId: Ulid;
      rejected?: Ulid;
      held?: { from: HeldSender["kind"]; edited: boolean };
    }
  | {
      name: "thread.continued";
      threadId: Ulid;
      from: Ulid;
      workstreamId: Ulid;
      kept: boolean;
    }
  | { name: "held-message.sent"; threadId: Ulid; from: HeldSender["kind"]; edited: boolean }
  | { name: "held-message.discarded"; threadId: Ulid; from: HeldSender["kind"] }
  // Never its input.
  | { name: "draft.made"; threadId: Ulid; action: ActionName }
  | { name: "draft.applied"; threadId: Ulid; action: ActionName; edited: boolean }
  | { name: "draft.discarded"; threadId: Ulid; action: ActionName; stale: boolean }
  | {
      name: "thread.marked-done";
      threadId: Ulid;
      via?: CloseVia;
      by?: Actor;
      undoes?: Actor;
      workstreamId?: Ulid;
    }
  | {
      name: "thread.deleted";
      threadId: Ulid;
      workstreamId: Ulid;
      kept: boolean;
      workstreamRemoved: boolean;
      via: CloseVia;
    }
  | { name: "grouping.switched"; grouping: string }
  // Older rows store this as `zoom.changed`, which a report maps.
  | { name: "cluster.opened" }
  | { name: "cluster.closed" }
  | { name: "changeset.edited"; changeSetId: Ulid }
  | { name: "changeset.revised"; changeSetId: Ulid; threadId: Ulid; mutations: number }
  | {
      name: "changeset.decided";
      changeSetId: Ulid;
      decision: "approved" | "rejected";
      via: "thread" | "review-link";
    }
  | { name: "changeset.unrejected"; changeSetId: Ulid }
  | { name: "changeset.applied"; changeSetId: Ulid; threadId: Ulid; sources: SourceKind[] }
  | { name: "changeset.dismissed"; changeSetId: Ulid; via: "thread" | "review-link" }
  | { name: "changeset.reverted"; changeSetId: Ulid; conflicts: number }
  | { name: "changeset.stalled"; changeSetId: Ulid; threadId: Ulid }
  // Never its words or quotes.
  | {
      name: "challenge.made";
      changeSetId: Ulid;
      kinds: Partial<Record<FindingKind, number>>;
      ms: number;
      tokens: number;
    }
  | { name: "challenge.failed"; changeSetId: Ulid; why: "no-record" | "error" }
  | { name: "challenge.companion-added"; changeSetId: Ulid }
  | { name: "review-link.opened"; changeSetId: Ulid }
  | { name: "review-link.refused"; changeSetId: Ulid; why: "deleted" }
  | { name: "item.panel-opened"; source: SourceKind }
  // Never its words.
  | {
      name: "standin.moving";
      source: SourceKind;
      step: "offered" | "moved";
      items: number;
    }
  | {
      name: "standin.written";
      source: SourceKind;
      by: "person" | "change-set";
      change: "created" | "edited" | "deleted";
      fields: string[];
    }
  | { name: "item.source-opened"; source: SourceKind; via: "panel" | "link" }
  | { name: "item.asked-about"; source: SourceKind }
  | { name: "item.dropped-on-composer"; source: SourceKind }
  | { name: "escape-hatch.used"; threadId: Ulid; runId: Ulid }
  | { name: "block.shown"; threadId: Ulid; form: BlockForm | "preview" }
  | { name: "block.refused"; threadId: Ulid }
  | { name: "block.regrouped" }
  // Never its text or the names refused.
  | { name: "sketch.shown"; threadId: Ulid; height: SketchHeight; bytes: number }
  | { name: "sketch.refused"; threadId: Ulid; reason: SketchRefusal }
  | { name: "chip.unknown"; threadId: Ulid; count: number }
  | { name: "window-chat.opened"; threadId: Ulid }
  | { name: "window-chat.new-chat"; threadId: Ulid; kept: boolean }
  | { name: "window-chat.continued"; threadId: Ulid; to: Ulid; made: boolean; kept: boolean }
  | { name: "window-chat.question-used"; question: StartQuestion }
  // How long the query was, never what it said.
  | { name: "threads.searched"; queryLength: number; results: number }
  | { name: "threads.search-opened"; opened: "thread" | "change-set"; rank: number }
  // How long the query was, never what it said.
  | { name: "items.searched"; queryLength: number; results: number }
  | { name: "overview.opened" }
  | { name: "overview.more-opened"; section: OverviewSection }
  | { name: "overview.suggestion-made"; workstreamId: Ulid; grouping: string }
  // Counts and times, never its words.
  | {
      name: "noticed.pass";
      offered: number;
      picked: number;
      dropped: number;
      inputTokens: number;
      outputTokens: number;
      firstMs: number | null;
      ms: number;
      ok: boolean;
    }
  | { name: "noticed.shown"; kind: SignalKind }
  | { name: "noticed.pinned"; kind: SignalKind }
  | { name: "noticed.dismissed"; kind: SignalKind }
  | { name: "theme.picked"; theme: string }
  | { name: "first-run.opened"; fresh: boolean }
  | { name: "first-run.cli-found"; cli: "claude-code" | "codex"; state: string }
  // Older events have no `cli`: they were Claude Code's.
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
  | {
      name: "first-run.test-turn";
      ms: number;
      inputTokens: number;
      outputTokens: number;
      failed?: string;
      cli?: "claude-code" | "codex";
    }
  // `api` only in events stored before the API key was retired.
  | { name: "first-run.ai-chosen"; ai: "claude-code" | "codex" | "api" }
  | { name: "first-run.step-skipped"; step: "ai" | "work" }
  | { name: "first-run.details-copied"; what: string }
  | { name: "first-run.finished"; ms: number; installed: boolean; signedIn: boolean }
  | { name: "action.called"; action: string; by: Actor; undoes?: Actor }
);
