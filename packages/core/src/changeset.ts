import type { Instant, ItemId, SourceKind, Ulid } from "./ids.ts";
import type { RunRef } from "./run.ts";
import type { CapturedMutation, NewRef } from "./sandbox.ts";
import type { FieldValues, WriteResult } from "./source.ts";

// Proof that a person approved this exact content. Only packages/changeset
// mints it, right before a write, after re-checking that the approval's hash
// matches the change set; no other package may name this type (checked by
// scripts/check-repo.ts). See decision 0003.
declare const approval: unique symbol;
export type Approved<T> = Readonly<T> & { readonly [approval]: Ulid };

export type MutationStatus = "pending" | "applied" | "failed";

export type MutationRecord<K extends SourceKind = SourceKind> = {
  id: Ulid;
  changeSetId: Ulid;
  // Replay order within the change set.
  seq: number;
  op: string;
  // Null for a create; a NewRef for an item created earlier in this change set.
  target: ItemId<K> | NewRef | null;
  // The temporary name a create gives its item.
  ref: NewRef | null;
  args: unknown;
  // What the diff showed at review time.
  preview: FieldValues | null;
  status: MutationStatus;
  // Written the moment the source answers, so a retried replay skips it.
  applied: (WriteResult<K> & { at: Instant }) | null;
  error: string | null;
};

export type Decision = {
  id: Ulid;
  kind: "approved" | "rejected";
  via: "thread" | "review-link";
  // The approver's typed name on a review link; the user in a thread.
  by: string;
  // The change set's hash at decision time. An edit changes the hash, which
  // voids the approval.
  hash: string;
  at: Instant;
};

// A review-link approver must present the link's live token.
export type Approver =
  | { via: "thread"; by: string }
  | { via: "review-link"; token: string; by: string };

export type ChangeSet = {
  id: Ulid;
  workspaceId: Ulid;
  threadId: Ulid;
  runId: Ulid;
  mutations: MutationRecord[];
  // Hash of the mutations' ops, targets and args.
  hash: string;
  decision: Decision | null;
  // Set when this change set reverts another.
  revertOf: Ulid | null;
  createdAt: Instant;
};

// One plain-language line per mutation: what it will do, with before and after.
export type Diff = {
  changeSetId: Ulid;
  lines: {
    mutationId: Ulid;
    sentence: string;
    target: ItemId | NewRef | null;
    fields: { name: string; before: unknown; after: unknown }[];
  }[];
};

export type ChangeSetPatch = {
  remove?: Ulid[];
  set?: { mutationId: Ulid; args: unknown }[];
};

export type ApplyReport = {
  changeSetId: Ulid;
  applied: Ulid[];
  skipped: Ulid[];
  failed: { mutationId: Ulid; error: string }[];
};

export type Conflict = {
  mutationId: Ulid;
  target: ItemId;
  field: string;
  expected: unknown;
  actual: unknown;
};

export interface ChangeSets {
  capture(run: RunRef, mutations: readonly CapturedMutation[]): Promise<ChangeSet>;
  // Reads current values live, so `before` is true at review time.
  diff(id: Ulid): Promise<Diff>;
  edit(id: Ulid, patch: ChangeSetPatch): Promise<ChangeSet>;
  decide(id: Ulid, kind: Decision["kind"], approver: Approver): Promise<ChangeSet>;
  // Writes only under an approval whose hash matches; replays exactly the
  // captured arguments in `seq` order; resumable after a crash.
  apply(id: Ulid): Promise<ApplyReport>;
  // A new change set of reverse mutations, approved like any other, or the
  // conflicts that stop it: fields the source changed since apply.
  revert(id: Ulid): Promise<ChangeSet | { conflicts: Conflict[] }>;
  // Creates or returns the live link. It dies after 7 days, on revoke, or once
  // the change set is decided.
  reviewLink(id: Ulid): Promise<URL>;
  revokeReviewLink(id: Ulid): Promise<void>;
  // What the review page shows; null for a dead or unknown token.
  openReview(token: string): Promise<{ changeSet: ChangeSet; diff: Diff } | null>;
}
