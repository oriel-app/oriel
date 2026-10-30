import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type ApplyReport,
  type Approved,
  type Approver,
  array,
  type CapturedMutation,
  type ChangeSet,
  type ChangeSetPatch,
  type ChangeSets,
  type Conflict,
  type Decision,
  type Diff,
  type FieldValues,
  type Instant,
  instant,
  type ItemId,
  isNewRef,
  type Issue,
  literal,
  type MutationRecord,
  type NewRef,
  nullable,
  object,
  optional,
  parseItemId,
  type RunRef,
  type SourceKind,
  sourceKinds,
  type SourceWriter,
  string,
  type TelemetryEvent,
  type Ulid,
  ulid,
  union,
  unknown,
  type Validator,
  type WriteRequest,
} from "@oriel/core";
import { transaction } from "@oriel/db";
import type { Catalogue, OpSpec, Subject } from "./catalogue.ts";
import { sameValue, sha256 } from "./hash.ts";
import { jiraCatalogue } from "./jira.ts";
import {
  newRefValue,
  store,
  targetValue,
  ulidValue,
  writeResult,
  type AppliedValue,
  type LinkRow,
} from "./store.ts";

// The read side a diff needs: values as they are now in the source.
export type Reader<K extends SourceKind = SourceKind> = {
  // Field names as in the source's catalogue (see jira.ts); "gone" when the
  // item no longer exists or can't be seen.
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  // A person's display name for a diff line; null when unknown.
  person(accountId: string): Promise<string | null>;
};

export type ChangeSetDeps = {
  db: DatabaseSync;
  // The writable sources. A source missing here is read-only.
  sources: { [K in SourceKind]?: { writer: SourceWriter<K>; reader: Reader<K> } };
  // A review link is this URL with the token appended as a last path segment.
  reviewBase: URL;
  now: () => Instant;
  emit: (event: TelemetryEvent) => void;
};

export type ChangeSetErrorCode =
  | "not-found"
  | "invalid"
  | "stale"
  | "refused"
  | "not-approved"
  | "busy"
  | "not-revertible";

export class ChangeSetError extends Error {
  readonly code: ChangeSetErrorCode;
  constructor(code: ChangeSetErrorCode, message: string) {
    super(message);
    this.name = "ChangeSetError";
    this.code = code;
  }
}

// The registry: how change sets treat each writable source's ops, keyed by
// source kind. Each entry is built over the adapter's own `OpCatalogue`. A
// source with no entry is read-only: no change set can touch its items.
const catalogues: Partial<Record<SourceKind, Catalogue>> = { jira: jiraCatalogue };

function catalogueFor(kind: SourceKind): Catalogue {
  const found = catalogues[kind];
  if (!found) throw new Error(`${kind} items are read-only`);
  return found;
}

function hasOp(kind: SourceKind, op: string): boolean {
  const found = catalogues[kind];
  return found !== undefined && Object.hasOwn(found.ops, op);
}

const linkLifetimeMs = 7 * 24 * 60 * 60 * 1000;
// How long an unanswered send is taken to be still on its way. Until then no
// other apply sends that row again, so a slow write can't land after a later
// one. A crashed send blocks its row this long.
export const sendLeaseMs = 5 * 60 * 1000;
// A send's mark ends with when it was sent and a nonce of its own.
const sendMark = / \(sent (\S+), [0-9A-Z]{26}\)$/;
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const maxErrorChars = 500;
// The preview of a line whose item was gone when the diff was shown. No
// catalogue field starts with "$".
const goneMark = "$gone";

// Boundary validators for what callers pass in. Each is typed against core's
// contract, so the two can't drift.
const runRef: Validator<RunRef> = object({
  id: ulidValue,
  threadId: ulidValue,
  workspaceId: ulidValue,
});
const capturedMutation: Validator<CapturedMutation> = object({
  op: string,
  target: nullable(targetValue),
  ref: nullable(newRefValue),
  args: unknown,
});
const patchValue: Validator<ChangeSetPatch> = object({
  remove: optional(array(ulidValue)),
  set: optional(array(object({ mutationId: ulidValue, args: unknown }))),
});
const decisionKind: Validator<Decision["kind"]> = union(literal("approved"), literal("rejected"));
const approverValue: Validator<Approver> = union(
  object({ via: literal("thread"), by: string }),
  object({ via: literal("review-link"), token: string, by: string }),
);

type Draft = CapturedMutation;
type Checked = Draft & { kind: SourceKind; spec: OpSpec };

function invalid(what: string, issues: Issue[]): ChangeSetError {
  return new ChangeSetError(
    "invalid",
    `${what}: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
  );
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > maxErrorChars ? `${text.slice(0, maxErrorChars - 1)}…` : text;
}

function key(id: string): string {
  return parseItemId(id)?.key ?? id;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function catalogueOf(item: ItemId): Catalogue {
  const kind = parseItemId(item)?.source;
  if (!kind) throw new Error(`not an item ID: ${item}`);
  return catalogueFor(kind);
}

// The one place an `Approved` value is made (decision 0003). Callers mint right
// before `writer.apply`, from rows whose hash the latest approval matches.
function mint<K extends SourceKind>(request: WriteRequest<K>): Approved<WriteRequest<K>> {
  return Object.freeze(request) as Approved<WriteRequest<K>>;
}

// The source a mutation writes to: its target's; for a new item, that of the
// create naming it; for a create, the one source whose catalogue has the op.
function kindOf(m: Draft, all: readonly Draft[]): SourceKind | null {
  if (m.target !== null && !isNewRef(m.target)) return parseItemId(m.target)?.source ?? null;
  if (m.target !== null) {
    const ref = m.target;
    const create = all.find((c) => c.ref === ref);
    return create && create.target === null ? kindOf(create, all) : null;
  }
  const owners = sourceKinds.filter((kind) => hasOp(kind, m.op));
  return owners.length === 1 ? (owners[0] ?? null) : null;
}

function specFor(m: Draft, all: readonly Draft[]): { kind: SourceKind; spec: OpSpec } | null {
  const kind = kindOf(m, all);
  if (kind === null || !hasOp(kind, m.op)) return null;
  const spec = catalogueFor(kind).ops[m.op];
  return spec ? { kind, spec } : null;
}

function mustSpec(m: Draft, all: readonly Draft[]): { kind: SourceKind; spec: OpSpec } {
  const found = specFor(m, all);
  if (!found) throw new Error(`no catalogue has the op ${m.op} for ${m.target ?? "a new item"}`);
  return found;
}

// Validates each mutation's arguments and its refs, in seq order: only a create
// names a new item, each name once, and a target may name only an item that an
// earlier create in the same change set names. Returns the validated arguments,
// which are what gets stored and replayed.
function check(drafts: readonly Draft[]): Checked[] {
  const named = new Set<NewRef>();
  return drafts.map((m, i) => {
    const where = `mutation ${i + 1} (${m.op})`;
    if (m.target !== null && isNewRef(m.target) && !named.has(m.target))
      throw new ChangeSetError(
        "invalid",
        `${where}: ${m.target} isn't created by an earlier mutation`,
      );
    const found = specFor(m, drafts);
    if (!found) throw new ChangeSetError("invalid", `${where}: not an operation Oriel can make`);
    const { spec } = found;
    if (spec.creates && m.target !== null)
      throw new ChangeSetError("invalid", `${where}: a create has no target`);
    if (!spec.creates && m.target === null)
      throw new ChangeSetError("invalid", `${where}: needs an item to change`);
    if (!spec.creates && m.ref !== null)
      throw new ChangeSetError("invalid", `${where}: only a create can name a new item`);
    if (m.ref !== null) {
      if (named.has(m.ref))
        throw new ChangeSetError("invalid", `${where}: ${m.ref} is named twice`);
      named.add(m.ref);
    }
    const args = spec.args(m.args, "$.args");
    if (!args.ok) throw invalid(where, args.issues);
    return {
      op: m.op,
      target: m.target,
      ref: m.ref,
      args: JSON.parse(JSON.stringify(args.value) ?? "null"),
      ...found,
    };
  });
}

// What in these mutations lies outside the region: a target (when `targets`),
// or an item ID among the arguments. `member` decides by stable ID. A NewRef
// target was checked by `check`. Arguments are replayed exactly, so a NewRef
// among them could never resolve and is refused as well.
function outsideRegion(
  checked: readonly { m: Checked; seq: number }[],
  member: (handle: string) => boolean,
  targets: boolean,
): string | null {
  for (const { m, seq } of checked) {
    const where = `mutation ${seq} (${m.op})`;
    if (targets && m.target !== null && !isNewRef(m.target) && !member(m.target))
      return `${where}: ${key(m.target)} isn't in this thread's region`;
    const stray = m.spec.refs(m.args).find((id) => !member(id));
    if (stray !== undefined) return `${where}: ${key(stray)} isn't in this thread's region`;
  }
  return null;
}

// Conflicts in plain words, for the thread and the review page. An `expected`
// of undefined means Oriel is missing a value it recorded at apply (before or
// after), so it can't revert that field safely.
export function explainConflicts(conflicts: readonly Conflict[]): string {
  const parts = conflicts.map((c) => {
    const item = key(c.target);
    const catalogue = catalogueOf(c.target);
    if (c.field === "item") return `${item} is no longer there`;
    if (c.field === catalogue.updatedField)
      return c.expected === undefined || c.expected === null
        ? `Oriel never learned when ${item} was last updated, so it can't tell whether anyone touched it`
        : `${item} was touched since Oriel created it`;
    if (c.expected === undefined)
      return `Oriel is missing ${item}'s ${c.field} from when this was applied, so it can't revert it safely`;
    return `${item}'s ${c.field} is now ${JSON.stringify(c.actual)}, not ${JSON.stringify(c.expected)}`;
  });
  return `Stopped, so nothing was overwritten: ${parts.join("; ")}.`;
}

export function changeSets(deps: ChangeSetDeps): ChangeSets {
  const { db } = deps;
  const rows = store(db);
  // Change sets this instance is applying; a second apply is refused until the
  // first returns, so no mutation is sent twice at once.
  const applying = new Set<string>();
  // Mutations whose write is in flight; an edit can't touch them.
  const sending = new Set<Ulid>();

  const at = (): { now: Instant; ms: number } => {
    const now = deps.now();
    return { now, ms: Date.parse(now) };
  };

  const mustLoad = (id: string): ChangeSet => {
    const set = rows.load(id);
    if (!set) throw new ChangeSetError("not-found", `no change set ${id}`);
    return set;
  };

  // The approval apply may write under: the latest decision, an approval, whose
  // hash matches the hash derived from the rows as they are now.
  const approvalOf = (set: ChangeSet): void => {
    if (set.decision?.kind === "approved") return;
    throw new ChangeSetError(
      "not-approved",
      "this change set isn't approved as it stands; review the diff and approve it",
    );
  };

  // A token's link while it lives: found by its hash, not revoked, and younger
  // than 7 days. Deciding a change set revokes its link, so a decided change
  // set has none.
  const liveLink = (token: unknown): LinkRow | null => {
    if (typeof token !== "string" || !tokenShape.test(token)) return null;
    const hash = sha256(token);
    const link = rows.link(hash);
    if (!link) return null;
    const stored = Buffer.from(link.token_hash, "hex");
    const given = Buffer.from(hash, "hex");
    if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
    if (link.revoked_at !== null) return null;
    if (at().ms >= Date.parse(link.created_at) + linkLifetimeMs) return null;
    return link;
  };

  const sourceOf = (kind: SourceKind): { writer: SourceWriter; reader: Reader } => {
    const found = deps.sources[kind];
    if (!found) throw new Error(`${kind} items are read-only`);
    return found;
  };
  const reader = (kind: SourceKind): Reader => sourceOf(kind).reader;

  // Lines for the rows of `set` as loaded, so `set.hash` is the hash of exactly
  // what is rendered. Applied lines show what the source reported; pending
  // ones read live values, carried forward through earlier lines. Also returns
  // the mutations whose item was gone.
  const render = async (set: ChangeSet): Promise<{ diff: Diff; gone: Set<Ulid> }> => {
    const creates = new Map<string, MutationRecord>();
    for (const m of set.mutations) if (m.ref !== null) creates.set(m.ref, m);
    const itemOf = (m: MutationRecord): ItemId | null => {
      if (m.applied) return m.applied.item.id;
      if (m.target === null) return null;
      if (!isNewRef(m.target)) return m.target;
      return creates.get(m.target)?.applied?.item.id ?? null;
    };

    const wanted = new Map<ItemId, { kind: SourceKind; fields: Set<string> }>();
    for (const m of set.mutations) {
      const item = itemOf(m);
      if (item === null) continue;
      const { kind, spec } = mustSpec(m, set.mutations);
      const entry = wanted.get(item) ?? { kind, fields: new Set([catalogueFor(kind).titleField]) };
      if (m.status !== "applied")
        for (const field of Object.keys(spec.after(m.args))) entry.fields.add(field);
      wanted.set(item, entry);
    }
    const live = new Map(
      await Promise.all(
        [...wanted].map(
          async ([item, { kind, fields }]) =>
            [item, await reader(kind).current(item, [...fields])] as const,
        ),
      ),
    );
    const title = async (id: ItemId): Promise<string | null> => {
      const kind = parseItemId(id)?.source;
      if (!kind) return null;
      const field = catalogueFor(kind).titleField;
      const values = live.get(id) ?? (await reader(kind).current(id, [field]));
      return values === "gone" ? null : text(values[field]);
    };

    // Field values per item (or new item's ref) as earlier lines leave them.
    const state = new Map<string, Record<string, unknown>>();
    const lines: Diff["lines"] = [];
    const gone = new Set<Ulid>();
    for (const m of set.mutations) {
      const { kind, spec } = mustSpec(m, set.mutations);
      const catalogue = catalogueFor(kind);
      const context = (subject: Subject, before: FieldValues) => ({
        subject,
        before,
        person: (accountId: string) => reader(kind).person(accountId),
        title,
      });
      const item = itemOf(m);

      if (m.applied && item !== null) {
        const { before, after } = m.applied;
        const now = live.get(item);
        const name =
          (now && now !== "gone" ? text(now[catalogue.titleField]) : null) ??
          text(after[catalogue.titleField]) ??
          text(before[catalogue.titleField]);
        const subject: Subject = m.target === null ? null : { kind: "item", id: item, title: name };
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
          (f) => f !== catalogue.updatedField,
        );
        lines.push({
          mutationId: m.id,
          sentence: await spec.describe(m.args, context(subject, before)),
          target: m.target,
          fields: fields.map((f) => ({
            name: f,
            before: before[f] ?? null,
            after: after[f] ?? null,
          })),
        });
        continue;
      }

      const after = spec.after(m.args);
      let subject: Subject = null;
      let values: Record<string, unknown> = {};
      if (item !== null) {
        const now = live.get(item);
        if (now === undefined || now === "gone") {
          gone.add(m.id);
          lines.push({
            mutationId: m.id,
            sentence: `${key(item)} is no longer in ${catalogue.name}, so this change can't be made.`,
            target: m.target,
            fields: [],
          });
          continue;
        }
        values = state.get(item) ?? { ...now };
        subject = { kind: "item", id: item, title: text(values[catalogue.titleField]) };
      } else if (m.target !== null && isNewRef(m.target)) {
        values = state.get(m.target) ?? {};
        subject = { kind: "new", ref: m.target, title: text(values[catalogue.titleField]) };
      }
      const before = Object.fromEntries(Object.keys(after).map((f) => [f, values[f] ?? null]));
      lines.push({
        mutationId: m.id,
        sentence: await spec.describe(m.args, context(subject, before)),
        target: m.target,
        fields: Object.keys(after).map((f) => ({ name: f, before: before[f], after: after[f] })),
      });
      const carry = item ?? m.target ?? m.ref;
      if (carry !== null) state.set(carry, { ...values, ...after });
    }
    return { diff: { changeSetId: set.id, hash: set.hash, lines }, gone };
  };

  // Records what the latest diff showed against each unapplied mutation: the
  // before values, or that the item couldn't be read. Approval requires a diff
  // since the last edit and none of its lines gone; a later render that reads
  // the item again replaces a gone line. Not while the change set is approved
  // (a rejection reopens it), and not if its rows changed while the diff was
  // rendering.
  const keepPreview = (set: ChangeSet, rendered: { diff: Diff; gone: Set<Ulid> }): void =>
    transaction(db, () => {
      const now = rows.load(set.id);
      if (!now || now.hash !== set.hash || now.decision?.kind === "approved") return;
      const open = new Set(now.mutations.filter((m) => m.status !== "applied").map((m) => m.id));
      for (const line of rendered.diff.lines) {
        if (!open.has(line.mutationId)) continue;
        rows.setPreview(
          line.mutationId,
          rendered.gone.has(line.mutationId)
            ? { [goneMark]: true }
            : Object.fromEntries(line.fields.map((f) => [f.name, f.before])),
        );
      }
    });

  const diff = async (set: ChangeSet): Promise<Diff> => {
    const rendered = await render(set);
    keepPreview(set, rendered);
    return rendered.diff;
  };

  // Conflicts between the source now and what each field was left at after
  // apply: per item and field, the last applied mutation's `after`. The update
  // time is skipped, since any write moves it. A set op whose `before` or
  // `after` lacks the field it set is a conflict (expected undefined), as is
  // one recorded without a `before` because it was in place or re-sent: Oriel
  // either can't tell whether anyone changed it or can't put it back. Once a
  // field is unknown, a later mutation on it doesn't hide that. A gone item is
  // one conflict on its field "item", against the last mutation that touched
  // it.
  const conflictsWith = async (applied: readonly MutationRecord[]): Promise<Conflict[]> => {
    type Expected = { last: Ulid; fields: Map<string, { value: unknown; mutationId: Ulid }> };
    const expected = new Map<ItemId, Expected>();
    const unknown = new Map<string, Ulid>();
    for (const m of applied) {
      if (!m.applied) continue;
      const item = m.applied.item.id;
      const catalogue = catalogueOf(item);
      const entry = expected.get(item) ?? { last: m.id, fields: new Map() };
      entry.last = m.id;
      const spec = Object.hasOwn(catalogue.ops, m.op) ? catalogue.ops[m.op] : undefined;
      const writes = new Set(spec?.idempotent ? Object.keys(spec.after(m.args)) : []);
      for (const field of writes) {
        // Without both values, a revert can't tell or can't put the field back.
        const known =
          Object.hasOwn(m.applied.before, field) && Object.hasOwn(m.applied.after, field);
        if (!known && !unknown.has(`${item}\u0000${field}`))
          unknown.set(`${item}\u0000${field}`, m.id);
      }
      for (const [field, value] of Object.entries(m.applied.after))
        if (field !== catalogue.updatedField) entry.fields.set(field, { value, mutationId: m.id });
      for (const field of writes)
        if (!entry.fields.has(field))
          entry.fields.set(field, { value: undefined, mutationId: m.id });
      expected.set(item, entry);
    }
    for (const [both, mutationId] of unknown) {
      const [item, field] = both.split("\u0000") as [ItemId, string];
      expected.get(item)?.fields.set(field, { value: undefined, mutationId });
    }
    const conflicts: Conflict[] = [];
    for (const [item, { last, fields }] of expected) {
      const kind = parseItemId(item)?.source;
      if (!kind || fields.size === 0) continue;
      const current = await sourceOf(kind).writer.current(item, [...fields.keys()]);
      if (current === "gone") {
        conflicts.push({
          mutationId: last,
          target: item,
          field: "item",
          expected: "present",
          actual: "gone",
        });
        continue;
      }
      for (const [field, { value, mutationId }] of fields) {
        const actual = Object.hasOwn(current, field) ? current[field] : null;
        if (value === undefined || !sameValue(actual, value))
          conflicts.push({ mutationId, target: item, field, expected: value, actual });
      }
    }
    return conflicts;
  };

  // An item a change set created may be deleted only if nobody touched it
  // since: its update time must still be the one the last of `onItem` (that
  // change set's applied mutations on it, in seq order) recorded. A missing
  // update time is a conflict too, with `expected` undefined or null.
  const touched = async (
    item: ItemId,
    onItem: readonly MutationRecord[],
  ): Promise<Conflict | null> => {
    const last = onItem.at(-1);
    if (!last?.applied) throw new Error(`no applied mutation on ${item}`);
    const kind = parseItemId(item)?.source;
    if (!kind) throw new Error(`not an item ID: ${item}`);
    const field = catalogueFor(kind).updatedField;
    const expected = last.applied.after[field];
    const current = await sourceOf(kind).writer.current(item, [field]);
    if (current === "gone")
      return {
        mutationId: last.id,
        target: item,
        field: "item",
        expected: "present",
        actual: "gone",
      };
    const actual = Object.hasOwn(current, field) ? current[field] : null;
    if (typeof expected === "string" && sameValue(actual, expected)) return null;
    return { mutationId: last.id, target: item, field, expected, actual };
  };

  // Rechecks, just before a reverse mutation is sent, the mutation it undoes:
  // the source may have changed since the revert was built.
  const recheck = async (reverts: Ulid): Promise<Conflict[]> => {
    const original = rows.mutation(reverts);
    if (!original?.applied)
      throw new Error(`reverse mutation undoes ${reverts}, which isn't applied`);
    const originalSet = mustLoad(original.changeSetId);
    if (!mustSpec(original, originalSet.mutations).spec.creates) return conflictsWith([original]);
    const item = original.applied.item.id;
    const conflict = await touched(
      item,
      originalSet.mutations.filter((m) => m.applied?.item.id === item),
    );
    return conflict ? [conflict] : [];
  };

  // Where a mutation writes: its target, or the item an earlier create in the
  // same change set made, as that create's stored result says.
  const resolve = (
    m: MutationRecord,
    set: ChangeSet,
  ): { target: ItemId | null } | { failed: string } => {
    if (m.target === null || !isNewRef(m.target)) return { target: m.target };
    const ref = m.target;
    const create = set.mutations.find((c) => c.ref === ref && c.seq < m.seq);
    if (!create?.applied) return { failed: `it changes ${ref}, which hasn't been created` };
    return { target: create.applied.item.id };
  };

  // The change set as its rows are now, under a live approval, and one of its
  // mutations. Throws once an edit or a later decision voids the approval.
  const approved = (id: string, mutationId: Ulid) => {
    const set = mustLoad(id);
    approvalOf(set);
    return { set, m: set.mutations.find((r) => r.id === mutationId) ?? null };
  };

  // The stable ID of the item a mutation writes to: from the result that made
  // it or that the mutation undoes, or else as the thread's region resolves
  // the handle, as capture did.
  const stableIdFor = (m: MutationRecord, set: ChangeSet, target: ItemId): string | null => {
    if (m.target !== null && isNewRef(m.target)) {
      const ref = m.target;
      return set.mutations.find((c) => c.ref === ref)?.applied?.item.stableId ?? null;
    }
    if (m.reverts) return rows.mutation(m.reverts)?.applied?.item.stableId ?? null;
    return rows.region(set.threadId, set.workspaceId).stableId(target);
  };

  // A set op whose value is already in place, as when an earlier send landed
  // but its answer was lost: the result to record without sending, or null.
  // Its `before` leaves the field out. Oriel can't know whether the value is
  // its own write or someone else's, so a revert can't put it back, and
  // reports a conflict rather than overwrite.
  const inPlace = async (
    m: MutationRecord,
    set: ChangeSet,
    kind: SourceKind,
    spec: OpSpec,
    target: ItemId,
  ): Promise<AppliedValue | null> => {
    const after = spec.after(m.args);
    const fields = Object.keys(after);
    const updated = catalogueFor(kind).updatedField;
    const current = await sourceOf(kind).writer.current(target, [...fields, updated]);
    if (current === "gone") return null;
    if (!fields.every((f) => Object.hasOwn(current, f) && sameValue(current[f], after[f])))
      return null;
    const stableId = stableIdFor(m, set, target);
    if (stableId === null) return null;
    return {
      item: { id: target, stableId },
      before: {},
      after: Object.fromEntries(
        [...fields, updated].filter((f) => Object.hasOwn(current, f)).map((f) => [f, current[f]]),
      ),
      at: deps.now(),
    };
  };

  // Sends unapplied mutations in seq order and stops at the first failure, so
  // a retry can't land a later mutation before an earlier one. Every write is
  // marked sent (failed, until its result is recorded) before it goes out, with
  // a mark unique to that send, so a crash mid-send leaves that on record and
  // of two instances only one can record the result. A stop before sending
  // leaves the row as it was, to be checked again next time. A sent set op is
  // retried, since it is idempotent and one already in place is recorded
  // without sending; a sent create or link is never sent again. A row already
  // sent when the pass began never records a `before` for the fields it writes:
  // an earlier send may have landed, so the source's "before" may be Oriel's
  // own value, and a revert must report that rather than restore it.
  const applyOnce = async (id: string): Promise<ApplyReport> => {
    const first = mustLoad(id);
    const report: ApplyReport = { changeSetId: first.id, applied: [], skipped: [], failed: [] };
    const halt = (mutationId: Ulid, error: string): ApplyReport => {
      rows.markStopped(mutationId, error);
      report.failed.push({ mutationId, error });
      return report;
    };
    const fail = (mutationId: Ulid, error: string): ApplyReport => {
      rows.markFailed(mutationId, error);
      report.failed.push({ mutationId, error });
      return report;
    };

    for (const { id: mutationId } of first.mutations) {
      let { set, m } = approved(id, mutationId);
      // A removal changes the hash, so a missing row can't pass the check.
      if (!m) continue;
      if (m.status === "applied") {
        report.skipped.push(mutationId);
        continue;
      }
      const seen = { status: m.status, error: m.error };
      const wasSent = m.status === "failed";
      const { kind, spec } = mustSpec(m, set.mutations);
      const source = catalogueFor(kind).name;
      const writes = Object.keys(spec.after(m.args));
      const uncertain = `It may have been made in ${source}: check, then remove it from the change set to continue.`;
      if (wasSent && !spec.idempotent) {
        report.failed.push({ mutationId, error: m.error ?? uncertain });
        return report;
      }
      // A send still unanswered may still be on its way: neither send it again
      // nor record it in place until its lease runs out. Nothing is written, so
      // the mark stays.
      const sentAt = m.error === null ? null : sendMark.exec(m.error)?.[1];
      if (wasSent && sentAt && at().ms < Date.parse(sentAt) + sendLeaseMs) {
        report.failed.push({
          mutationId,
          error: `Oriel sent this at ${sentAt} and has no answer yet; it may still be on its way. Retry apply after ${instant(new Date(Date.parse(sentAt) + sendLeaseMs))}.`,
        });
        return report;
      }
      // Approval refuses both of these already; apply checks again anyway.
      if (m.preview === null)
        return halt(
          mutationId,
          "This hasn't been shown in a diff since the last edit, so it wasn't sent. Review the diff, then approve it.",
        );
      if (m.preview[goneMark] === true)
        return halt(
          mutationId,
          `${key(m.target ?? "the new item")} couldn't be read when this was last reviewed, so it wasn't sent. Review it again once it can be read.`,
        );
      let where = resolve(m, set);
      if ("failed" in where) return halt(mutationId, where.failed);
      if (spec.idempotent && where.target !== null) {
        const result = await inPlace(m, set, kind, spec, where.target);
        if (result) {
          ({ m } = approved(id, mutationId));
          if (!m) continue;
          rows.markApplied(mutationId, m, result);
          report.applied.push(mutationId);
          continue;
        }
      }
      if (m.reverts) {
        const conflicts = await recheck(m.reverts);
        if (conflicts.length) return halt(mutationId, explainConflicts(conflicts));
      }

      // Every await is behind us: from this check to the write nothing awaits,
      // so the rows whose hash matched the approval are the rows sent.
      ({ set, m } = approved(id, mutationId));
      if (!m) continue;
      if (m.status === "applied") {
        report.skipped.push(mutationId);
        continue;
      }
      where = resolve(m, set);
      if ("failed" in where) return halt(mutationId, where.failed);
      const request = mint({ mutationId: m.id, op: m.op, target: where.target, args: m.args });
      const notice = spec.idempotent
        ? `Sent to ${source}, with no answer recorded yet. Retry apply: Oriel checks whether it landed before sending it again.`
        : uncertain;
      const { now: sentNow, ms: sentMs } = at();
      const mark = `${notice} (sent ${sentNow}, ${ulid(sentMs)})`;
      // Only from the row as this pass first saw it: if another apply sent it
      // meanwhile, its send isn't repeated and its mark isn't reset.
      if (!rows.markSent(mutationId, seen, mark)) {
        report.failed.push({
          mutationId,
          error: "Another apply is sending this change right now, so it wasn't sent again.",
        });
        return report;
      }
      const sent = { status: "failed" as const, args: m.args, error: mark };
      const unsure = spec.idempotent ? "" : ` ${uncertain}`;
      sending.add(mutationId);
      try {
        let result: unknown;
        try {
          result = await sourceOf(kind).writer.apply(request);
        } catch (error) {
          return fail(mutationId, `${message(error).replace(/\.$/, "")}.${unsure}`);
        }
        const checked = writeResult(result);
        if (!checked.ok) {
          return fail(
            mutationId,
            `The source answered in a shape Oriel can't read: ${JSON.stringify(checked.issues)}.${unsure}`,
          );
        }
        const before = wasSent
          ? Object.fromEntries(
              Object.entries(checked.value.before).filter(([f]) => !writes.includes(f)),
            )
          : checked.value.before;
        rows.markApplied(mutationId, sent, { ...checked.value, before, at: deps.now() });
      } finally {
        sending.delete(mutationId);
      }
      report.applied.push(mutationId);
    }

    const done = mustLoad(id);
    if (report.applied.length && done.mutations.every((m) => m.status === "applied")) {
      deps.emit({
        name: "changeset.applied",
        at: deps.now(),
        workspaceId: done.workspaceId,
        changeSetId: done.id,
        threadId: done.threadId,
      });
    }
    return report;
  };

  const reviewUrl = (token: string): URL => {
    const url = new URL(deps.reviewBase);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${token}`;
    url.search = "";
    url.hash = "";
    return url;
  };

  // Inserts a change set and its mutations; the caller holds the transaction.
  const insertAll = (
    set: { id: Ulid; workspaceId: Ulid; threadId: Ulid; runId: Ulid | null; revertOf: Ulid | null },
    mutations: readonly (Draft & { reverts: Ulid | null })[],
  ): void => {
    const { now, ms } = at();
    rows.insertChangeSet({ ...set, createdAt: now });
    mutations.forEach((m, i) =>
      rows.insertMutation(set.workspaceId, set.id, {
        id: ulid(ms),
        seq: i + 1,
        op: m.op,
        target: m.target,
        ref: m.ref,
        args: m.args,
        reverts: m.reverts,
      }),
    );
  };

  return {
    async capture(run, mutations) {
      const owner = runRef(run, "$.run");
      if (!owner.ok) throw invalid("run", owner.issues);
      const parsed = array(capturedMutation)(mutations, "$.mutations");
      if (!parsed.ok) throw invalid("mutations", parsed.issues);
      if (parsed.value.length === 0)
        throw new ChangeSetError("invalid", "a change set needs at least one mutation");
      if (!rows.runExists(owner.value))
        throw new ChangeSetError("not-found", `no run ${owner.value.id} in that thread`);
      const checked = check(parsed.value);
      const revertOnly = checked.findIndex((m) => m.spec.revertOnly);
      if (revertOnly >= 0)
        throw new ChangeSetError(
          "invalid",
          `mutation ${revertOnly + 1} (${checked[revertOnly]?.op}): exists only to revert a change, so a run can't ask for it`,
        );
      const region = rows.region(owner.value.threadId, owner.value.workspaceId);
      const outside = outsideRegion(
        checked.map((m, i) => ({ m, seq: i + 1 })),
        (handle) => region.has(handle),
        true,
      );
      if (outside) throw new ChangeSetError("refused", outside);
      const id = ulid(at().ms);
      transaction(db, () =>
        insertAll(
          {
            id,
            workspaceId: owner.value.workspaceId,
            threadId: owner.value.threadId,
            runId: owner.value.id,
            revertOf: null,
          },
          checked.map((m) => ({ ...m, reverts: null })),
        ),
      );
      return mustLoad(id);
    },

    async diff(id) {
      return diff(mustLoad(id));
    },

    async edit(id, patch) {
      const parsed = patchValue(patch, "$.patch");
      if (!parsed.ok) throw invalid("edit", parsed.issues);
      const remove = new Set(parsed.value.remove ?? []);
      const changes = new Map((parsed.value.set ?? []).map((s) => [s.mutationId, s.args]));
      const changed = transaction(db, () => {
        const current = mustLoad(id);
        for (const mutationId of [...remove, ...changes.keys()]) {
          const m = current.mutations.find((r) => r.id === mutationId);
          if (!m)
            throw new ChangeSetError("not-found", `no mutation ${mutationId} in this change set`);
          if (m.status === "applied")
            throw new ChangeSetError(
              "refused",
              `mutation ${m.seq} is already applied and can't be edited`,
            );
          if (sending.has(m.id))
            throw new ChangeSetError(
              "refused",
              `mutation ${m.seq} is being applied right now and can't be edited`,
            );
          // A revert puts back what was there; changing a row of it would
          // write something else under that name. Rows can only be removed.
          if (m.reverts !== null && changes.has(mutationId))
            throw new ChangeSetError(
              "refused",
              `mutation ${m.seq} undoes an earlier change: remove it from the revert instead of editing it`,
            );
          // A sent row may have landed: it can be removed, never changed.
          if (m.status === "failed" && changes.has(mutationId))
            throw new ChangeSetError(
              "refused",
              `mutation ${m.seq}: this change may already be in ${catalogueFor(mustSpec(m, current.mutations).kind).name}: check, then remove it`,
            );
          if (remove.has(mutationId) && changes.has(mutationId))
            throw new ChangeSetError("invalid", `mutation ${m.seq} is both removed and changed`);
        }
        const kept = current.mutations.filter((m) => !remove.has(m.id));
        if (kept.length === 0)
          throw new ChangeSetError(
            "invalid",
            "an edit can't remove every mutation; reject the change set instead",
          );
        const checked = check(
          kept.map((m) => ({ ...m, args: changes.has(m.id) ? changes.get(m.id) : m.args })),
        );
        // Targets don't change in an edit, and a revert's may be items it
        // created, so only the edited arguments are held to the region.
        const edited = kept.flatMap((row, i) => {
          const m = checked[i];
          return m && changes.has(row.id) ? [{ id: row.id, seq: row.seq, m }] : [];
        });
        const region = rows.region(current.threadId, current.workspaceId);
        const outside = outsideRegion(edited, (handle) => region.has(handle), false);
        if (outside) throw new ChangeSetError("refused", outside);
        for (const mutationId of remove) rows.remove(current.id, mutationId);
        for (const { id: mutationId, m } of edited) rows.setArgs(current.id, mutationId, m.args);
        // An edit that changes nothing changes nothing: the approval and what
        // the diff showed both stand. Otherwise the earlier diff no longer
        // stands for these rows, and the new hash voids the approval.
        const unchanged = mustLoad(current.id).hash === current.hash;
        if (!unchanged) rows.clearPreviews(current.id);
        return { current, unchanged };
      });
      if (!changed.unchanged)
        deps.emit({
          name: "changeset.edited",
          at: deps.now(),
          workspaceId: changed.current.workspaceId,
          changeSetId: changed.current.id,
        });
      return mustLoad(id);
    },

    async decide(id, kind, approver, reviewed) {
      const decision = decisionKind(kind, "$.kind");
      if (!decision.ok) throw invalid("decision", decision.issues);
      const who = approverValue(approver, "$.approver");
      if (!who.ok) throw invalid("approver", who.issues);
      if (typeof reviewed !== "string")
        throw new ChangeSetError("invalid", "reviewed must be a hash");
      const by = who.value.by.trim();
      const set = transaction(db, () => {
        const { now, ms } = at();
        let link: LinkRow | null = null;
        if (who.value.via === "review-link") {
          link = liveLink(who.value.token);
          if (!link || link.change_set_id !== id)
            throw new ChangeSetError("refused", "this review link isn't live for this change set");
          if (by === "")
            throw new ChangeSetError("refused", "type your name to decide through a review link");
        }
        const current = mustLoad(id);
        if (current.hash !== reviewed) {
          throw new ChangeSetError(
            "stale",
            "this change set changed after you reviewed it; review the new diff",
          );
        }
        // An approval needs a diff shown since the last edit for every row it
        // will send, and none of them shown as gone.
        const open = current.mutations.filter((m) => m.status !== "applied");
        const unseen = open.find((m) => m.preview === null);
        const gone = open.find((m) => m.preview?.[goneMark] === true);
        if (decision.value === "approved" && unseen)
          throw new ChangeSetError(
            "refused",
            `mutation ${unseen.seq} hasn't been shown in a diff since the last edit; review the diff, then approve`,
          );
        if (decision.value === "approved" && gone)
          throw new ChangeSetError(
            "refused",
            `${key(gone.target ?? "the new item")} couldn't be read when this was last reviewed: remove that change, or review it again once it can be read`,
          );
        rows.insertDecision({
          id: ulid(ms),
          workspaceId: current.workspaceId,
          changeSetId: current.id,
          kind: decision.value,
          via: who.value.via,
          reviewLink: link?.token_hash ?? null,
          by,
          hash: reviewed,
          at: now,
        });
        // A decided change set's link dies.
        rows.revokeLinks(current.id, now);
        return current;
      });
      deps.emit({
        name: "changeset.decided",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
        decision: decision.value,
        via: who.value.via,
      });
      return mustLoad(id);
    },

    async apply(id) {
      if (applying.has(id))
        throw new ChangeSetError("busy", "this change set is already being applied");
      applying.add(id);
      try {
        return await applyOnce(id);
      } finally {
        applying.delete(id);
      }
    },

    // Reverses what has been applied. Refused while any unapplied row was sent,
    // since it may have landed and a revert would leave it behind. A partly
    // applied change set loses its unsent rows in the same transaction, so
    // nothing more of it can land; that voids its approval.
    async revert(id) {
      const busy = () =>
        new ChangeSetError("busy", "this change set is being applied; revert it once that ends");
      const sentUnapplied = (current: ChangeSet): ChangeSetError | null => {
        const m = current.mutations.find((r) => r.status === "failed");
        if (!m) return null;
        const source = catalogueFor(mustSpec(m, current.mutations).kind).name;
        return new ChangeSetError(
          "not-revertible",
          `mutation ${m.seq} (${m.op}) was sent and may have landed: retry apply first, or check ${source} and remove it`,
        );
      };
      const set = mustLoad(id);
      const unsent = sentUnapplied(set);
      if (unsent) throw unsent;
      const applied = set.mutations.filter((m) => m.applied !== null);
      if (applied.length === 0)
        throw new ChangeSetError("not-revertible", "nothing in this change set has been applied");

      // Items this change set created. Everything it did to one is undone by
      // deleting it, once.
      const created = new Map<ItemId, MutationRecord>();
      for (const m of applied)
        if (m.applied && mustSpec(m, set.mutations).spec.creates) created.set(m.applied.item.id, m);

      // Conflicts first: a value Oriel never learned is reported here, not
      // turned into a reverse it can't build.
      const conflicts: Conflict[] = [];
      for (const item of created.keys()) {
        const conflict = await touched(
          item,
          applied.filter((m) => m.applied?.item.id === item),
        );
        if (conflict) conflicts.push(conflict);
      }
      conflicts.push(
        ...(await conflictsWith(
          applied.filter((m) => m.applied && !created.has(m.applied.item.id)),
        )),
      );
      if (conflicts.length) {
        deps.emit({
          name: "changeset.reverted",
          at: deps.now(),
          workspaceId: set.workspaceId,
          changeSetId: set.id,
          conflicts: conflicts.length,
        });
        return { conflicts };
      }

      const undo: (Draft & { reverts: Ulid })[] = [];
      for (const m of [...applied].reverse()) {
        if (!m.applied) continue;
        const item = m.applied.item.id;
        const create = created.get(item);
        if (create && create !== m) continue;
        const step = mustSpec(m, set.mutations).spec.undo(m.args, m.applied);
        if ("refused" in step)
          throw new ChangeSetError(
            "not-revertible",
            `mutation ${m.seq} (${m.op}) can't be reverted: ${step.refused}`,
          );
        undo.push({ reverts: m.id, op: step.op, target: item, ref: null, args: step.args });
      }
      const checked = check(undo);
      const reverseId = ulid(at().ms);
      transaction(db, () => {
        // Nothing may have been sent, landed or started since the plan was made.
        const now = mustLoad(set.id);
        const appliedNow = now.mutations.filter((m) => m.applied !== null).map((m) => m.id);
        if (applying.has(set.id) || appliedNow.join() !== applied.map((m) => m.id).join())
          throw busy();
        const sentNow = sentUnapplied(now);
        if (sentNow) throw sentNow;
        insertAll(
          {
            id: reverseId,
            workspaceId: set.workspaceId,
            threadId: set.threadId,
            runId: null,
            revertOf: set.id,
          },
          checked.map((m, i) => ({ ...m, reverts: undo[i]?.reverts ?? null })),
        );
        for (const m of now.mutations) if (m.applied === null) rows.remove(now.id, m.id);
      });
      deps.emit({
        name: "changeset.reverted",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
        conflicts: 0,
      });
      return mustLoad(reverseId);
    },

    async reviewLink(id) {
      const token = randomBytes(32).toString("base64url");
      transaction(db, () => {
        const set = mustLoad(id);
        if (set.decision) throw new ChangeSetError("refused", "this change set is already decided");
        const { now } = at();
        rows.revokeLinks(set.id, now);
        rows.insertLink(sha256(token), set.workspaceId, set.id, now);
      });
      return reviewUrl(token);
    },

    async revokeReviewLink(id) {
      const set = mustLoad(id);
      rows.revokeLinks(set.id, at().now);
    },

    // The review route (not built yet) must send `Referrer-Policy: no-referrer`
    // and `Cache-Control: no-store`, and must not call this on the GET a link
    // unfurler makes: it reads the source and records previews.
    async openReview(token) {
      const link = liveLink(token);
      if (!link) return null;
      const set = rows.load(link.change_set_id);
      if (!set) return null;
      const shown = await diff(set);
      deps.emit({
        name: "review-link.opened",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
      });
      return { changeSet: set, diff: shown };
    },
  };
}
