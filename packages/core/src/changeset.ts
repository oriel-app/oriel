import type { Instant, ItemId, SourceKind, Ulid } from "./ids.ts";
import type { ChangeRead } from "./oriel-reads.ts";
import type { RunRef } from "./run.ts";
import type { CapturedMutation, NewRef } from "./sandbox.ts";
import type { FieldValues, WriteResult } from "./source.ts";

// Only packages/changeset mints it, right before a write, after re-checking the approval's hash;
// no other package may name it (scripts/check-repo.ts).
declare const approval: unique symbol;
export type Approved<T> = Readonly<T> & { readonly [approval]: Ulid };

export type MutationStatus = "pending" | "applied" | "failed";

export type MutationRecord<K extends SourceKind = SourceKind> = {
  id: Ulid;
  changeSetId: Ulid;
  seq: number;
  op: string;
  target: ItemId<K> | NewRef | null;
  ref: NewRef | null;
  into?: K;
  args: unknown;
  preview: FieldValues | null;
  status: MutationStatus;
  // Written the moment the source answers, so a retried replay skips it.
  applied: (WriteResult<K> & { at: Instant }) | null;
  error: string | null;
  reverts: Ulid | null;
  // Moves on with every write: a conditional write compares the version it read. Not part of the hash.
  version: number;
};

export type Decision = {
  id: Ulid;
  kind: "approved" | "rejected";
  via: "thread" | "review-link";
  by: string;
  // An edit changes the change set's hash, which voids the approval.
  hash: string;
  at: Instant;
};

export type Approver =
  | { via: "thread"; by: string }
  | { via: "review-link"; token: string; by: string };

export type ChangeSet = {
  id: Ulid;
  workspaceId: Ulid;
  threadId: Ulid;
  runId: Ulid | null;
  mutations: MutationRecord[];
  // Derived from the mutation rows each time, never stored.
  hash: string;
  decision: Decision | null;
  revertOf: Ulid | null;
  createdAt: Instant;
  completedAt: Instant | null;
  revisedAt: Instant | null;
};

export type NextStep =
  | { kind: "approve" }
  | { kind: "approve-rest" }
  | { kind: "reject" }
  | { kind: "remove"; mutationIds: Ulid[] }
  | { kind: "retry" }
  | { kind: "revert" }
  | { kind: "dismiss"; warnings: string[] };

export type Diff = {
  changeSetId: Ulid;
  // The hash of the rows these lines were built from, not a fresh read, so a person approves exactly what they saw.
  hash: string;
  lines: {
    mutationId: Ulid;
    sentence: string;
    target: ItemId | NewRef | null;
    kind: "create" | "change" | "delete";
    makes: string | null;
    source: string;
    check?: { refused: string } | { later: string };
    fields: {
      name: string;
      before: unknown;
      after: unknown;
      createdAbove?: true;
      titles?: { before: string | null; after: string | null };
    }[];
  }[];
};

export type Known = { name(id: string): string | null; title(id: ItemId): string | null };

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
  get(id: Ulid): Promise<ChangeSet | null>;
  ofThread(threadId: Ulid): Promise<ChangeSet[]>;
  // Reads current values live, so `before` is true at review time.
  diff(id: Ulid): Promise<Diff>;
  // Records nothing, so it never stands for what the person saw.
  look(id: Ulid): Promise<Diff>;
  extend(id: Ulid, mutations: readonly CapturedMutation[], max: number): Promise<ChangeSet>;
  revisable(id: Ulid, threadId: Ulid): Promise<string | null>;
  revise(id: Ulid, run: RunRef, mutations: readonly CapturedMutation[]): Promise<ChangeSet>;
  changes(set: ChangeSet, known: Known): Promise<ChangeRead[]>;
  edit(id: Ulid, patch: ChangeSetPatch): Promise<ChangeSet>;
  // `reviewed`: the hash of the diff the person saw; refused if the change set changed since.
  decide(
    id: Ulid,
    kind: Decision["kind"],
    approver: Approver,
    reviewed: string,
  ): Promise<ChangeSet>;
  // Only the person's own rejection in the thread; its review link stays dead.
  undoRejection(id: Ulid): Promise<ChangeSet>;
  // Writes only under an approval whose hash matches the rows it's about to send; resumes after a crash.
  apply(id: Ulid): Promise<ApplyReport>;
  revert(id: Ulid): Promise<ChangeSet | { conflicts: Conflict[] }>;
  // Only the token's hash is stored, so a link can't be shown twice.
  reviewLink(id: Ulid): Promise<URL>;
  revokeReviewLink(id: Ulid): Promise<void>;
  revokeAllReviewLinks(workspaceId: Ulid): Promise<number>;
  // Records nothing: the caller says whether it was opened.
  openReview(token: string): Promise<{ changeSet: ChangeSet; diff: Diff } | null>;
  reviewLinkOpened(token: string): Promise<void>;
  unopenedLinks(
    workspaceId: Ulid,
  ): Promise<{ changeSetId: Ulid; threadId: Ulid; sentAt: Instant }[]>;
  nextSteps(id: Ulid): Promise<NextStep[]>;
  applying(id: Ulid): boolean;
  stalled(id: Ulid): boolean;
  writable(id: Ulid): boolean;
  cannotUndo(id: Ulid): string | null;
  dismiss(
    id: Ulid,
    by?: Approver,
    reviewed?: string,
  ): Promise<{ changeSet: ChangeSet; warnings: string[] }>;
}
