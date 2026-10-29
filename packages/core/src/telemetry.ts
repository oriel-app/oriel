import type { Instant, SourceKind, Ulid } from "./ids.ts";
import type { ZoomId } from "./zoom.ts";

// Pilot telemetry, stored locally. Only raw events are stored; these are
// derived from them, never stored:
// - first question asked: the earliest `question.asked`
// - first change set approved, and the time since connect (the onboarding
//   budget): the earliest approving `changeset.decided` minus `source.connected`
// - time to done: from `thread.opened` to the thread's first `changeset.applied`
export type TelemetryEvent = { at: Instant; workspaceId: Ulid } & (
  | { name: "source.connected"; source: SourceKind }
  | { name: "thread.opened"; threadId: Ulid; regionSize: number }
  | { name: "question.asked"; threadId: Ulid }
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
  | { name: "changeset.reverted"; changeSetId: Ulid; conflicts: number }
  | { name: "review-link.opened"; changeSetId: Ulid }
  | { name: "escape-hatch.used"; threadId: Ulid; runId: Ulid }
);
