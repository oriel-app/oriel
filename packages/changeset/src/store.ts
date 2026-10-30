import type { DatabaseSync } from "node:sqlite";
import {
  type ChangeSet,
  type Decision,
  type Infer,
  type Instant,
  type ItemId,
  isInstant,
  isItemId,
  isNewRef,
  isUlid,
  literal,
  parseItemId,
  type MutationRecord,
  type MutationStatus,
  type NewRef,
  nullable,
  number,
  object,
  record,
  refine,
  string,
  type Ulid,
  union,
  unknown,
  type Validator,
} from "@oriel/core";
import { groupStore } from "@oriel/db";
import { changeSetHash } from "./hash.ts";

export const ulidValue = refine(string, isUlid, "expected a ULID");
export const instantValue = refine(string, isInstant, "expected a canonical instant");
export const itemIdValue = refine(string, isItemId, "expected an item ID");
export const newRefValue = refine(string, isNewRef, "expected a new:N ref");
export const targetValue = refine(
  string,
  (value): value is ItemId | NewRef => isItemId(value) || isNewRef(value),
  "expected an item ID or a new:N ref",
);

// What a writer returns, checked before it is stored: revert depends on it.
export const writeResult = object({
  item: object({ id: itemIdValue, stableId: string }),
  before: record(unknown),
  after: record(unknown),
});
const appliedValue = object({
  item: object({ id: itemIdValue, stableId: string }),
  before: record(unknown),
  after: record(unknown),
  at: instantValue,
});

const changeSetRow = object({
  id: ulidValue,
  workspace_id: ulidValue,
  thread_id: ulidValue,
  run_id: nullable(ulidValue),
  revert_of: nullable(ulidValue),
  created_at: instantValue,
  completed_at: nullable(instantValue),
});
const mutationRow = object({
  id: ulidValue,
  change_set_id: ulidValue,
  seq: number,
  op: string,
  target: nullable(targetValue),
  ref: nullable(newRefValue),
  args: string,
  preview: nullable(string),
  status: union(literal("pending"), literal("applied"), literal("failed")),
  applied: nullable(string),
  error: nullable(string),
  reverts: nullable(ulidValue),
});
const decisionRow = object({
  id: ulidValue,
  kind: union(literal("approved"), literal("rejected")),
  via: union(literal("thread"), literal("review-link")),
  by_name: string,
  hash: string,
  at: instantValue,
});
const linkRow = object({
  token_hash: string,
  change_set_id: ulidValue,
  created_at: instantValue,
  revoked_at: nullable(instantValue),
});
const nextRow = object({ next: number });
const stableIdRow = object({ stable_id: string });
const runRegionRow = object({ group_id: ulidValue, region_version: number });
const foundRow = object({ found: number });

export type LinkRow = Infer<typeof linkRow>;
export type AppliedValue = Infer<typeof appliedValue>;

function parse<T>(validator: Validator<T>, raw: unknown, what: string): T {
  const result = validator(raw);
  if (!result.ok) throw new Error(`corrupt ${what} row: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function json<T>(validator: Validator<T>, text: string, what: string): T {
  return parse(validator, JSON.parse(text), what);
}

export type NewMutation = {
  id: Ulid;
  seq: number;
  op: string;
  target: ItemId | NewRef | null;
  ref: NewRef | null;
  args: unknown;
  reverts: Ulid | null;
};

export type Store = ReturnType<typeof store>;

// The change_sets, mutations, decisions and review_links tables. Plain reads
// and writes; the rules live in change-sets.ts.
export function store(db: DatabaseSync) {
  const selectChangeSet = db.prepare(
    "select id, workspace_id, thread_id, run_id, revert_of, created_at, completed_at from change_sets where id = ?",
  );
  const selectMutations = db.prepare(`
    select id, change_set_id, seq, op, target, ref, args, preview, status, applied, error, reverts
    from mutations where change_set_id = ? order by seq`);
  const selectMutation = db.prepare(`
    select id, change_set_id, seq, op, target, ref, args, preview, status, applied, error, reverts
    from mutations where id = ?`);
  const selectLatestDecision = db.prepare(`
    select id, kind, via, by_name, hash, at from decisions
    where change_set_id = ? order by seq desc limit 1`);
  const selectNextDecisionSeq = db.prepare(
    "select coalesce(max(seq), 0) + 1 as next from decisions where change_set_id = ?",
  );
  const markCompleted = db.prepare(`
    update change_sets set completed_at = ?
    where id = ? and completed_at is null
      and not exists (select 1 from mutations where change_set_id = change_sets.id and status != 'applied')
      and exists (select 1 from mutations where change_set_id = change_sets.id)`);
  const selectOfThread = db.prepare(
    "select id from change_sets where thread_id = ? order by created_at, rowid",
  );
  const selectRevertsOf = db.prepare(
    "select id from change_sets where revert_of = ? order by created_at, rowid",
  );
  const selectRun = db.prepare(
    "select count(*) as found from runs where id = ? and thread_id = ? and workspace_id = ?",
  );
  // The group a run's thread is on, and the version of it the run used.
  const selectRunRegion = db.prepare(`
    select t.group_id, r.region_version from runs r join threads t on t.id = r.thread_id
    where r.id = ? and r.workspace_id = ?`);
  const groups = groupStore(db);
  const selectInGroup = db.prepare(`
    select exists (
      select 1 from threads t join group_members m on m.group_id = t.group_id
      where t.id = ? and m.source = ? and m.stable_id = ? and m.removed_version is null
    ) as found`);
  // The item a handle names now: the live one, or else the latest tombstone.
  const selectStableId = db.prepare(`
    select stable_id from items where workspace_id = ? and source = ? and item_id = ?
    order by gone_at is not null, gone_at desc limit 1`);
  const insertChangeSet = db.prepare(`
    insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at)
    values (?, ?, ?, ?, ?, ?)`);
  const insertMutation = db.prepare(`
    insert into mutations (id, workspace_id, change_set_id, seq, op, target, ref, args, status, reverts)
    values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`);
  const updateArgs = db.prepare(
    "update mutations set args = ? where id = ? and change_set_id = ? and status != 'applied'",
  );
  const deleteMutation = db.prepare(
    "delete from mutations where id = ? and change_set_id = ? and status != 'applied'",
  );
  const updatePreview = db.prepare(
    "update mutations set preview = ? where id = ? and status != 'applied'",
  );
  const clearPreviews = db.prepare(
    "update mutations set preview = null where change_set_id = ? and status = 'pending'",
  );
  const updateApplied = db.prepare(`
    update mutations set status = 'applied', applied = ?, error = null
    where id = ? and status = ? and args = ? and error is ?`);
  const updateFailed = db.prepare(
    "update mutations set status = 'failed', error = ? where id = ? and status != 'applied'",
  );
  const updateSent = db.prepare(
    "update mutations set status = 'failed', error = ? where id = ? and status = ? and error is ?",
  );
  const updateRefused = db.prepare(
    "update mutations set status = ?, error = ? where id = ? and status != 'applied'",
  );
  const updateStopped = db.prepare(
    "update mutations set error = ? where id = ? and status != 'applied'",
  );
  const insertDecision = db.prepare(`
    insert into decisions (id, workspace_id, change_set_id, seq, kind, via, review_link, by_name, hash, at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectLink = db.prepare(
    "select token_hash, change_set_id, created_at, revoked_at from review_links where token_hash = ?",
  );
  const revokeLinks = db.prepare(
    "update review_links set revoked_at = ? where change_set_id = ? and revoked_at is null",
  );
  const insertLink = db.prepare(
    "insert into review_links (token_hash, workspace_id, change_set_id, created_at) values (?, ?, ?, ?)",
  );

  // The stable ID of the item a handle names in the index, or null.
  const stableIdOf = (workspaceId: Ulid, handle: string): string | null => {
    const source = parseItemId(handle)?.source;
    if (!source) return null;
    const raw = selectStableId.get(workspaceId, source, handle);
    return raw ? parse(stableIdRow, raw, "items").stable_id : null;
  };

  const toMutation = (raw: unknown): MutationRecord => {
    const row = parse(mutationRow, raw, "mutations");
    const status: MutationStatus = row.status;
    return {
      id: row.id,
      changeSetId: row.change_set_id,
      seq: row.seq,
      op: row.op,
      target: row.target,
      ref: row.ref,
      args: JSON.parse(row.args),
      preview:
        row.preview === null ? null : json(record(unknown), row.preview, "mutations.preview"),
      status,
      applied: row.applied === null ? null : json(appliedValue, row.applied, "mutations.applied"),
      error: row.error,
      reverts: row.reverts,
    };
  };

  return {
    // A change set as its rows say now, with the hash derived from them. Its
    // decision is the latest one, and only while its hash still matches.
    load(id: string): ChangeSet | null {
      const raw = selectChangeSet.get(id);
      if (!raw) return null;
      const row = parse(changeSetRow, raw, "change_sets");
      const mutations = selectMutations.all(id).map(toMutation);
      const hash = changeSetHash(mutations);
      const latest = selectLatestDecision.get(id);
      const decision = latest ? parse(decisionRow, latest, "decisions") : null;
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        threadId: row.thread_id,
        runId: row.run_id,
        mutations,
        hash,
        decision:
          decision && decision.hash === hash
            ? ({
                id: decision.id,
                kind: decision.kind,
                via: decision.via,
                by: decision.by_name,
                hash: decision.hash,
                at: decision.at,
              } satisfies Decision)
            : null,
        revertOf: row.revert_of,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      };
    },

    // The change sets that revert this one, oldest first.
    revertsOf(changeSetId: Ulid): Ulid[] {
      return selectRevertsOf
        .all(changeSetId)
        .map((raw) => parse(object({ id: ulidValue }), raw, "change_sets").id);
    },

    mutation(id: Ulid): MutationRecord | null {
      const raw = selectMutation.get(id);
      return raw ? toMutation(raw) : null;
    },

    // A thread's change sets, oldest first.
    ofThread(threadId: Ulid): Ulid[] {
      return selectOfThread
        .all(threadId)
        .map((raw) => parse(object({ id: ulidValue }), raw, "change_sets").id);
    },

    runExists(run: { id: Ulid; threadId: Ulid; workspaceId: Ulid }): boolean {
      return (
        parse(foundRow, selectRun.get(run.id, run.threadId, run.workspaceId), "runs").found > 0
      );
    },

    stableId: stableIdOf,

    // Whether the thread's group holds an item now, in its latest version.
    inGroupNow(threadId: Ulid, source: string, stableId: string): boolean {
      return (
        parse(foundRow, selectInGroup.get(threadId, source, stableId), "group_members").found > 0
      );
    },

    // Handles as the region a run used sees them: its thread's group at the
    // run's version (decision 0018). A change set no run produced, a revert,
    // has no region. Membership is by stable ID (decision 0004). A handle
    // resolves through the index first, so one reused by another item names
    // that item and is refused. A handle no index row has, such as a moved
    // item's old one, falls back to the handle the member was added with.
    // Capture, edit and apply all resolve this way.
    region(runId: Ulid | null, workspaceId: Ulid) {
      const raw = runId === null ? undefined : selectRunRegion.get(runId, workspaceId);
      const at = raw ? parse(runRegionRow, raw, "runs") : null;
      const items = at ? (groups.region(at.group_id, at.region_version)?.items ?? []) : [];
      const rows = items.map((item) => ({
        source: parseItemId(item.id)?.source ?? "",
        stable_id: item.stableId,
        item_id: item.id,
      }));
      const members = new Set(rows.map((row) => `${row.source}\u0000${row.stable_id}`));
      const created = new Map<string, string>(rows.map((row) => [row.item_id, row.stable_id]));
      const stableId = (handle: string): string | null =>
        stableIdOf(workspaceId, handle) ?? created.get(handle) ?? null;
      return {
        stableId,
        has(handle: string): boolean {
          const source = parseItemId(handle)?.source;
          const id = stableId(handle);
          return source !== undefined && id !== null && members.has(`${source}\u0000${id}`);
        },
      };
    },

    insertChangeSet(set: {
      id: Ulid;
      workspaceId: Ulid;
      threadId: Ulid;
      runId: Ulid | null;
      revertOf: Ulid | null;
      createdAt: Instant;
    }): void {
      insertChangeSet.run(
        set.id,
        set.workspaceId,
        set.threadId,
        set.runId,
        set.revertOf,
        set.createdAt,
      );
    },

    insertMutation(workspaceId: Ulid, changeSetId: Ulid, m: NewMutation): void {
      insertMutation.run(
        m.id,
        workspaceId,
        changeSetId,
        m.seq,
        m.op,
        m.target,
        m.ref,
        JSON.stringify(m.args),
        m.reverts,
      );
    },

    setArgs(changeSetId: Ulid, mutationId: Ulid, args: unknown): void {
      updateArgs.run(JSON.stringify(args), mutationId, changeSetId);
    },

    remove(changeSetId: Ulid, mutationId: Ulid): void {
      deleteMutation.run(mutationId, changeSetId);
    },

    setPreview(mutationId: Ulid, preview: Record<string, unknown>): void {
      updatePreview.run(JSON.stringify(preview), mutationId);
    },

    // After an edit, every unsent row needs a fresh diff before approval. A
    // sent row keeps what the diff showed when it was approved: its source
    // may hold the change by now, so a fresh read can't show what was there.
    clearPreviews(changeSetId: Ulid): void {
      clearPreviews.run(changeSetId);
    },

    // Records a result only on the row as it was sent: same status, same
    // arguments, same mark (a send's mark carries its own nonce, so of two
    // instances that both sent a row only the last to mark it can record it).
    // Throws otherwise, since the write landed but its row was removed,
    // edited, applied or sent again meanwhile.
    markApplied(
      mutationId: Ulid,
      sent: { status: MutationStatus; args: unknown; error: string | null },
      applied: Infer<typeof appliedValue>,
    ): void {
      const { changes } = updateApplied.run(
        JSON.stringify(applied),
        mutationId,
        sent.status,
        JSON.stringify(sent.args),
        sent.error,
      );
      if (Number(changes) !== 1)
        throw new Error(
          `mutation ${mutationId} landed in the source, but its row changed meanwhile`,
        );
    },

    // A write that failed, or that may have landed: it was sent.
    markFailed(mutationId: Ulid, error: string): void {
      updateFailed.run(error, mutationId);
    },

    // Records, before a write goes out, that it was sent: until its result is
    // recorded, it may have landed. Only from the row as the caller saw it
    // (status and message), so another apply's mark is never overwritten;
    // false if the row moved on. `mark` should be unique to this send.
    markSent(
      mutationId: Ulid,
      from: { status: MutationStatus; error: string | null },
      mark: string,
    ): boolean {
      return Number(updateSent.run(mark, mutationId, from.status, from.error).changes) === 1;
    },

    // The source answered a send and made no change: the row goes back to the
    // status the caller gives (unsent, unless an earlier send may be in place).
    markRefused(mutationId: Ulid, status: MutationStatus, error: string): void {
      updateRefused.run(status, error, mutationId);
    },

    // Apply stopped before sending this mutation. The status stays as it was, so
    // a row an earlier pass sent keeps that mark; the next apply checks again.
    markStopped(mutationId: Ulid, error: string): void {
      updateStopped.run(error, mutationId);
    },

    insertDecision(d: {
      id: Ulid;
      workspaceId: Ulid;
      changeSetId: Ulid;
      kind: Decision["kind"];
      via: Decision["via"];
      reviewLink: string | null;
      by: string;
      hash: string;
      at: Instant;
    }): void {
      const seq = parse(nextRow, selectNextDecisionSeq.get(d.changeSetId), "decisions").next;
      insertDecision.run(
        d.id,
        d.workspaceId,
        d.changeSetId,
        seq,
        d.kind,
        d.via,
        d.reviewLink,
        d.by,
        d.hash,
        d.at,
      );
    },

    link(tokenHash: string): LinkRow | null {
      const raw = selectLink.get(tokenHash);
      return raw ? parse(linkRow, raw, "review_links") : null;
    },

    revokeLinks(changeSetId: Ulid, at: Instant): void {
      revokeLinks.run(at, changeSetId);
    },

    // Records when a change set's last change applied, once. True if this
    // call recorded it.
    markCompleted(changeSetId: Ulid, at: Instant): boolean {
      return Number(markCompleted.run(at, changeSetId).changes) === 1;
    },

    insertLink(tokenHash: string, workspaceId: Ulid, changeSetId: Ulid, at: Instant): void {
      insertLink.run(tokenHash, workspaceId, changeSetId, at);
    },
  };
}
