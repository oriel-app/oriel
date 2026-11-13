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
  type SourceKind,
  string,
  type Ulid,
  union,
  unknown,
  type Validator,
} from "@oriel/core";
import { workstreamStore } from "@oriel/db";
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
  revised_at: nullable(instantValue),
});
const mutationRow = object({
  id: ulidValue,
  change_set_id: ulidValue,
  seq: number,
  op: string,
  target: nullable(targetValue),
  ref: nullable(newRefValue),
  create_kind: nullable(string),
  args: string,
  preview: nullable(string),
  status: union(literal("pending"), literal("applied"), literal("failed")),
  applied: nullable(string),
  error: nullable(string),
  reverts: nullable(ulidValue),
  version: number,
});
const decisionRow = object({
  id: ulidValue,
  kind: union(literal("approved"), literal("rejected")),
  via: union(literal("thread"), literal("review-link")),
  by_name: string,
  hash: string,
  at: instantValue,
  undone_at: nullable(instantValue),
});
const linkRow = object({
  token_hash: string,
  change_set_id: ulidValue,
  created_at: instantValue,
  revoked_at: nullable(instantValue),
});
const unopenedRow = object({
  change_set_id: ulidValue,
  thread_id: ulidValue,
  created_at: instantValue,
});
const nextRow = object({ next: number });
const stableIdRow = object({ stable_id: string });
const runRegionRow = object({ workstream_id: ulidValue, region_version: number });
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
  into?: SourceKind;
  args: unknown;
  reverts: Ulid | null;
};

export type Store = ReturnType<typeof store>;

export function store(db: DatabaseSync) {
  const selectChangeSet = db.prepare(
    "select id, workspace_id, thread_id, run_id, revert_of, created_at, completed_at, revised_at from change_sets where id = ?",
  );
  const selectMutations = db.prepare(`
    select id, change_set_id, seq, op, target, ref, create_kind, args, preview, status, applied, error,
      reverts, version
    from mutations where change_set_id = ? order by seq`);
  const selectMutation = db.prepare(`
    select id, change_set_id, seq, op, target, ref, create_kind, args, preview, status, applied, error,
      reverts, version
    from mutations where id = ?`);
  const selectLatestDecision = db.prepare(`
    select id, kind, via, by_name, hash, at, undone_at from decisions
    where change_set_id = ? order by seq desc limit 1`);
  const selectStandingDecision = db.prepare(
    "select exists (select 1 from decisions where change_set_id = ? and undone_at is null) as found",
  );
  const markUndone = db.prepare(
    "update decisions set undone_at = ? where id = ? and undone_at is null",
  );
  const selectNextDecisionSeq = db.prepare(
    "select coalesce(max(seq), 0) + 1 as next from decisions where change_set_id = ?",
  );
  const markRevised = db.prepare("update change_sets set run_id = ?, revised_at = ? where id = ?");
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
  const selectRunModel = db.prepare("select model from runs where id = ?");
  const selectRunRegion = db.prepare(`
    select t.workstream_id, r.region_version from runs r join threads t on t.id = r.thread_id
    where r.id = ? and r.workspace_id = ?`);
  const workstreams = workstreamStore(db);
  const selectInWorkstream = db.prepare(`
    select exists (
      select 1 from threads t join workstream_members m on m.workstream_id = t.workstream_id
      where t.id = ? and m.source = ? and m.stable_id = ? and m.removed_version is null
    ) as found`);
  const selectStableId = db.prepare(`
    select stable_id from items where workspace_id = ? and source = ? and item_id = ?
    order by gone_at is not null, gone_at desc limit 1`);
  const insertChangeSet = db.prepare(`
    insert into change_sets (id, workspace_id, thread_id, run_id, revert_of, created_at)
    values (?, ?, ?, ?, ?, ?)`);
  const insertMutation = db.prepare(`
    insert into mutations (id, workspace_id, change_set_id, seq, op, target, ref, create_kind, args, status, reverts)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`);
  // Every write to a mutation row moves its version on; the conditional ones
  // write only over the version the caller read.
  const updateArgs = db.prepare(`
    update mutations set args = ?, version = version + 1
    where id = ? and change_set_id = ? and status != 'applied'`);
  const deleteMutation = db.prepare(
    "delete from mutations where id = ? and change_set_id = ? and status != 'applied'",
  );
  const updatePreview = db.prepare(`
    update mutations set preview = ?, version = version + 1
    where id = ? and status != 'applied'`);
  const clearPreviews = db.prepare(`
    update mutations set preview = null, version = version + 1
    where change_set_id = ? and status = 'pending'`);
  const updateApplied = db.prepare(`
    update mutations set status = 'applied', applied = ?, error = null, version = version + 1
    where id = ? and version = ? and status != 'applied'`);
  const updateFailed = db.prepare(`
    update mutations set status = 'failed', error = ?, version = version + 1
    where id = ? and version = ? and status != 'applied'`);
  const updateSent = db.prepare(`
    update mutations set status = 'failed', error = ?, version = version + 1
    where id = ? and version = ? and status != 'applied'`);
  const updateRefused = db.prepare(`
    update mutations set status = ?, error = ?, version = version + 1
    where id = ? and version = ? and status != 'applied'`);
  const updateStopped = db.prepare(`
    update mutations set error = ?, version = version + 1
    where id = ? and version = ? and status != 'applied'`);
  const insertDecision = db.prepare(`
    insert into decisions (id, workspace_id, change_set_id, seq, kind, via, review_link, by_name, hash, at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectLink = db.prepare(
    "select token_hash, change_set_id, created_at, revoked_at from review_links where token_hash = ?",
  );
  const revokeLinks = db.prepare(
    "update review_links set revoked_at = ? where change_set_id = ? and revoked_at is null",
  );
  const revokeAllLinks = db.prepare(
    "update review_links set revoked_at = ? where workspace_id = ? and revoked_at is null",
  );
  const insertLink = db.prepare(
    "insert into review_links (token_hash, workspace_id, change_set_id, created_at) values (?, ?, ?, ?)",
  );
  const markLinkOpened = db.prepare(
    "update review_links set opened_at = ? where token_hash = ? and opened_at is null",
  );
  const selectUnopened = db.prepare(`
    select l.change_set_id, s.thread_id, l.created_at
    from review_links l join change_sets s on s.id = l.change_set_id
    where l.workspace_id = ? and l.revoked_at is null and l.opened_at is null and l.created_at > ?
    order by l.created_at, l.change_set_id`);

  const stableIdOf = (workspaceId: Ulid, handle: string): string | null => {
    const source = parseItemId(handle)?.prefix;
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
      ...(row.create_kind === null ? {} : { into: row.create_kind }),
      args: JSON.parse(row.args),
      preview:
        row.preview === null ? null : json(record(unknown), row.preview, "mutations.preview"),
      status,
      applied: row.applied === null ? null : json(appliedValue, row.applied, "mutations.applied"),
      error: row.error,
      reverts: row.reverts,
      version: row.version,
    };
  };

  return {
    // Its decision is the latest one, only while its hash still matches and nobody undid it.
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
          decision && decision.hash === hash && decision.undone_at === null
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
        revisedAt: row.revised_at,
      };
    },

    revertsOf(changeSetId: Ulid): Ulid[] {
      return selectRevertsOf
        .all(changeSetId)
        .map((raw) => parse(object({ id: ulidValue }), raw, "change_sets").id);
    },

    mutation(id: Ulid): MutationRecord | null {
      const raw = selectMutation.get(id);
      return raw ? toMutation(raw) : null;
    },

    ofThread(threadId: Ulid): Ulid[] {
      return selectOfThread
        .all(threadId)
        .map((raw) => parse(object({ id: ulidValue }), raw, "change_sets").id);
    },

    // An edit voids an approval only while the rows differ from what was approved, so this ignores the hash.
    everDecided(changeSetId: Ulid): boolean {
      return parse(foundRow, selectStandingDecision.get(changeSetId), "decisions").found > 0;
    },

    runModel(runId: Ulid): string | null {
      const row = selectRunModel.get(runId);
      return row ? parse(object({ model: string }), row, "runs").model : null;
    },

    runExists(run: { id: Ulid; threadId: Ulid; workspaceId: Ulid }): boolean {
      return (
        parse(foundRow, selectRun.get(run.id, run.threadId, run.workspaceId), "runs").found > 0
      );
    },

    stableId: stableIdOf,

    inWorkstreamNow(threadId: Ulid, source: string, stableId: string): boolean {
      return (
        parse(foundRow, selectInWorkstream.get(threadId, source, stableId), "workstream_members")
          .found > 0
      );
    },

    // A handle resolves through the index first, so one reused by another item names that item and is refused; one no
    // index row has, such as a moved item's old handle, falls back to the handle the member was added with.
    region(runId: Ulid | null, workspaceId: Ulid) {
      const raw = runId === null ? undefined : selectRunRegion.get(runId, workspaceId);
      const at = raw ? parse(runRegionRow, raw, "runs") : null;
      const items = at
        ? (workstreams.region(at.workstream_id, at.region_version)?.items ?? [])
        : [];
      const rows = items.map((item) => ({
        source: parseItemId(item.id)?.prefix ?? "",
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
          const source = parseItemId(handle)?.prefix;
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
        m.into ?? null,
        JSON.stringify(m.args),
        m.reverts,
      );
    },

    setArgs(changeSetId: Ulid, mutationId: Ulid, args: unknown): void {
      updateArgs.run(JSON.stringify(args), mutationId, changeSetId);
    },

    markRevised(changeSetId: Ulid, runId: Ulid, at: Instant): void {
      markRevised.run(runId, at, changeSetId);
    },

    remove(changeSetId: Ulid, mutationId: Ulid): void {
      deleteMutation.run(mutationId, changeSetId);
    },

    setPreview(mutationId: Ulid, preview: Record<string, unknown>): void {
      updatePreview.run(JSON.stringify(preview), mutationId);
    },

    // A sent row keeps what the diff showed when it was approved: its source may hold the change by now.
    clearPreviews(changeSetId: Ulid): void {
      clearPreviews.run(changeSetId);
    },

    // Only on the row as the caller read it, so of two instances that both sent a row only the last to mark it records it.
    // Throws otherwise: the write landed but its row changed meanwhile.
    markApplied(
      mutationId: Ulid,
      from: { version: number },
      applied: Infer<typeof appliedValue>,
    ): void {
      const { changes } = updateApplied.run(JSON.stringify(applied), mutationId, from.version);
      if (Number(changes) !== 1)
        throw new Error(
          `mutation ${mutationId} landed in the source, but its row changed meanwhile`,
        );
    },

    // A write that failed, or that may have landed: it was sent.
    markFailed(mutationId: Ulid, from: { version: number }, error: string): boolean {
      return Number(updateFailed.run(error, mutationId, from.version).changes) === 1;
    },

    // Before a write goes out: until its result is recorded, it may have landed. Only from the row as the caller read it,
    // so another apply's mark is never overwritten.
    markSent(mutationId: Ulid, from: { version: number }, mark: string): number | null {
      return Number(updateSent.run(mark, mutationId, from.version).changes) === 1
        ? from.version + 1
        : null;
    },

    // Only from the row as the caller read it: if anything wrote to it since, it stays as that left it.
    markRefused(
      mutationId: Ulid,
      from: { version: number },
      status: MutationStatus,
      error: string,
    ): boolean {
      return Number(updateRefused.run(status, error, mutationId, from.version).changes) === 1;
    },

    // The status stays as it was, so a row an earlier pass sent stays sent.
    markStopped(mutationId: Ulid, from: { version: number }, error: string): boolean {
      return Number(updateStopped.run(error, mutationId, from.version).changes) === 1;
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

    undoDecision(decisionId: Ulid, at: Instant): boolean {
      return markUndone.run(at, decisionId).changes > 0;
    },

    link(tokenHash: string): LinkRow | null {
      const raw = selectLink.get(tokenHash);
      return raw ? parse(linkRow, raw, "review_links") : null;
    },

    revokeLinks(changeSetId: Ulid, at: Instant): void {
      revokeLinks.run(at, changeSetId);
    },

    revokeAllLinks(workspaceId: Ulid, at: Instant): number {
      return Number(revokeAllLinks.run(at, workspaceId).changes);
    },

    markCompleted(changeSetId: Ulid, at: Instant): boolean {
      return Number(markCompleted.run(at, changeSetId).changes) === 1;
    },

    insertLink(tokenHash: string, workspaceId: Ulid, changeSetId: Ulid, at: Instant): void {
      insertLink.run(tokenHash, workspaceId, changeSetId, at);
    },

    markLinkOpened(tokenHash: string, at: Instant): void {
      markLinkOpened.run(at, tokenHash);
    },

    unopenedLinks(
      workspaceId: Ulid,
      after: Instant,
    ): { changeSetId: Ulid; threadId: Ulid; sentAt: Instant }[] {
      return selectUnopened.all(workspaceId, after).map((raw) => {
        const row = parse(unopenedRow, raw, "review_links");
        return { changeSetId: row.change_set_id, threadId: row.thread_id, sentAt: row.created_at };
      });
    },
  };
}
