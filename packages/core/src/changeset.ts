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
  // On a reverse mutation, the mutation it undoes.
  reverts: Ulid | null;
  // Moves on with every write to the row: a conditional write compares the
  // version it read. Not part of the change set's hash.
  version: number;
};

export type Decision = {
  id: Ulid;
  kind: "approved" | "rejected";
  via: "thread" | "review-link";
  // The approver's typed name on a review link; the user in a thread.
  by: string;
  // The hash of the change set as the person reviewed it. An edit changes the
  // change set's hash, which voids the approval.
  hash: string;
  at: Instant;
};

// A review-link approver presents a live token minted for this same change set,
// and a non-empty typed name.
export type Approver =
  | { via: "thread"; by: string }
  | { via: "review-link"; token: string; by: string };

export type ChangeSet = {
  id: Ulid;
  workspaceId: Ulid;
  threadId: Ulid;
  // Null for a revert, which no run produced.
  runId: Ulid | null;
  mutations: MutationRecord[];
  // Hash of the mutations' seq, op, target, ref and args. Derived from the
  // mutation rows each time, never stored.
  hash: string;
  decision: Decision | null;
  // Set when this change set reverts another.
  revertOf: Ulid | null;
  createdAt: Instant;
  // When its last change applied, whichever way it got there: an apply, an
  // edit that left out the last unapplied change, or a revert that dropped
  // the unsent ones. Null until then. A thread's "done" counts from this.
  completedAt: Instant | null;
};

// What a person can do with a change set as it stands, and nothing the
// engine would refuse. Derived from the change set, its reverts and the
// writers configured; never stored.
export type NextStep =
  // Approve it as it stands, which applies it.
  | { kind: "approve" }
  // Part of it applied, then an edit voided the approval: approve the rest.
  | { kind: "approve-rest" }
  // Decline it before anything landed.
  | { kind: "reject" }
  // Leave these changes out, one at a time.
  | { kind: "remove"; mutationIds: Ulid[] }
  // Apply again from where it stopped, or for the first time.
  | { kind: "retry" }
  // A new change set that undoes what this one applied.
  | { kind: "revert" }
  // End a change set that started landing, or may have: what hasn't applied
  // never will. Each warning names a change that may already be in its
  // source, for the person to check.
  | { kind: "dismiss"; warnings: string[] };

// One plain-language line per mutation: what it will do, with before and after.
export type Diff = {
  changeSetId: Ulid;
  // The hash of the same mutation rows these lines were built from, not a
  // fresh read. A decision carries it back, so a person approves exactly what
  // they saw.
  hash: string;
  lines: {
    mutationId: Ulid;
    sentence: string;
    target: ItemId | NewRef | null;
    // What the line does to its item: makes it, changes some of its fields,
    // or deletes it.
    kind: "create" | "change" | "delete";
    // `createdAbove`: the value names an item an earlier line creates.
    // `titles`: on a field whose values name items (an epic), those items'
    // titles as the change set leaves them.
    fields: {
      name: string;
      before: unknown;
      after: unknown;
      createdAbove?: true;
      titles?: { before: string | null; after: string | null };
    }[];
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
  // The change set as its rows are now, or null. Reads nothing from a source.
  get(id: Ulid): Promise<ChangeSet | null>;
  // A thread's change sets, oldest first: those its runs captured, and its
  // reverts.
  ofThread(threadId: Ulid): Promise<ChangeSet[]>;
  // Reads current values live, so `before` is true at review time.
  diff(id: Ulid): Promise<Diff>;
  edit(id: Ulid, patch: ChangeSetPatch): Promise<ChangeSet>;
  // `reviewed` is the hash from the diff the person saw. The decision is
  // refused if the change set has changed since.
  decide(
    id: Ulid,
    kind: Decision["kind"],
    approver: Approver,
    reviewed: string,
  ): Promise<ChangeSet>;
  // Writes only under an approval whose hash matches the hash derived from the
  // mutation rows it is about to send. Replays exactly the captured arguments,
  // in `seq` order, and can resume after a crash.
  apply(id: Ulid): Promise<ApplyReport>;
  // A new change set of reverse mutations, approved like any other, or the
  // conflicts that stop it: fields the source changed since apply.
  revert(id: Ulid): Promise<ChangeSet | { conflicts: Conflict[] }>;
  // Mints a new link and revokes any earlier one: only the token's hash is
  // stored, so a link can't be shown twice. It dies after 7 days, on revoke, or
  // once the change set is decided.
  reviewLink(id: Ulid): Promise<URL>;
  revokeReviewLink(id: Ulid): Promise<void>;
  // What the review page shows; null for a dead or unknown token.
  openReview(token: string): Promise<{ changeSet: ChangeSet; diff: Diff } | null>;
  // Exactly what can be done with it now (`NextStep`): each step is an
  // action whose own guard passes, so none offered is refused. Every message
  // the engine shows a person names only these. Empty while it is applying.
  nextSteps(id: Ulid): Promise<NextStep[]>;
  // Whether this instance is applying it now. Until that ends, every action
  // on it is refused as busy.
  applying(id: Ulid): boolean;
  // Ends a change set that started landing, or may have: its unapplied
  // changes are rejected for good, and a revert covers exactly what applied.
  // The warnings name any change that may already have landed. Dismissing
  // twice changes nothing.
  // In the thread by default; through a review link, as `decide` checks one.
  // `reviewed`, when given, is the hash of the diff the person saw; a stale
  // one is refused.
  dismiss(
    id: Ulid,
    by?: Approver,
    reviewed?: string,
  ): Promise<{ changeSet: ChangeSet; warnings: string[] }>;
}
