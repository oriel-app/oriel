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
  type Log,
  literal,
  type MutationRecord,
  type NextStep,
  type OpSpec,
  type OpSpecs,
  type NewRef,
  nullable,
  object,
  optional,
  parseItemId,
  type RunRef,
  type SourceKind,
  sourceKinds,
  SourceRefused,
  type SourceWriter,
  string,
  type Subject,
  type TelemetryEvent,
  type Ulid,
  ulid,
  union,
  unknown,
  type Validator,
  type WriteRequest,
} from "@oriel/core";
import { transaction } from "@oriel/db";
import { sameValue, sha256 } from "./hash.ts";
import { buildWriters, type WriterConfig } from "./writers.ts";
import {
  newRefValue,
  store,
  targetValue,
  ulidValue,
  writeResult,
  type AppliedValue,
  type LinkRow,
} from "./store.ts";

// The read side a diff needs: field values as they are now in the source.
// Not core's `Reader`, which reads whole items for a run.
export type FieldReader<K extends SourceKind = SourceKind> = {
  // Field names as in the source's op specs; "gone" when the
  // item no longer exists or can't be seen.
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  // A person's display name for a diff line; null when unknown.
  person(accountId: string): Promise<string | null>;
};

export type ChangeSetDeps = {
  db: DatabaseSync;
  // How to reach each writable source. Change sets build the writers from it
  // (writers.ts): nothing passes a writer in, so none exists outside this
  // package (decision 0003). A source with no config is read-only.
  writerConfig: WriterConfig;
  // A person's display name for a diff line, by source; null when unknown.
  people?: { [K in SourceKind]?: (personId: string) => Promise<string | null> };
  // How a source with no writer config reads its current values, so its
  // change sets can still be captured and diffed. They can't be approved
  // until writing to the source is configured.
  readers?: { [K in SourceKind]?: FieldReader<K> };
  // How each writable source's ops are checked, shown, applied and reverted,
  // as its adapter declares them.
  specs: Specs;
  // A review link is this URL with the token appended as a last path segment.
  reviewBase: URL;
  now: () => Instant;
  emit: (event: TelemetryEvent) => void;
  log: Log;
};

// Each source's writer, null when writing to it isn't configured, and the
// field reader its diffs use.
export type Sources = {
  [K in SourceKind]?: { writer: SourceWriter<K> | null; reader: FieldReader<K> };
};

// What the engine runs on: the deps, with the writers built.
export type EngineDeps = Omit<ChangeSetDeps, "writerConfig" | "people" | "readers" | "log"> & {
  sources: Sources;
};

export type ChangeSetErrorCode =
  | "not-found"
  | "invalid"
  | "stale"
  | "refused"
  | "not-approved"
  | "busy"
  | "not-revertible"
  // Writing to the source isn't configured, so nothing can be approved.
  | "read-only";

export class ChangeSetError extends Error {
  readonly code: ChangeSetErrorCode;
  constructor(code: ChangeSetErrorCode, message: string) {
    super(message);
    this.name = "ChangeSetError";
    this.code = code;
  }
}

// The registry: how change sets treat each writable source's ops, by source
// kind, as each adapter declares them over its own `OpCatalogue`. A source
// with no entry is read-only: no change set can touch its items.
export type Specs = Partial<Record<SourceKind, OpSpecs>>;

function catalogueFor(specs: Specs, kind: SourceKind): OpSpecs {
  const found = specs[kind];
  if (!found) throw new Error(`${kind} items are read-only`);
  return found;
}

function hasOp(specs: Specs, kind: SourceKind, op: string): boolean {
  const found = specs[kind];
  return found !== undefined && Object.hasOwn(found.ops, op);
}

const linkLifetimeMs = 7 * 24 * 60 * 60 * 1000;
// How long an unanswered send is taken to be still on its way. Until then no
// other apply sends that row again, so a slow write can't land after a later
// one. A crashed send blocks its row this long.
export const sendLeaseMs = 5 * 60 * 1000;
// A send's mark ends with when it was sent.
const sendMark = / \(sent (\S+)\)$/;
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const maxErrorChars = 500;
// The preview of a line whose item was gone when the diff was shown. No
// catalogue field starts with "$".
const goneMark = "$gone";
// For a mutation whose stored arguments no longer pass its source's catalogue,
// as one captured before the catalogue tightened.
const staleArgs = "This change's stored arguments are no longer valid";

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

function catalogueOf(specs: Specs, item: ItemId): OpSpecs {
  const kind = parseItemId(item)?.source;
  if (!kind) throw new Error(`not an item ID: ${item}`);
  return catalogueFor(specs, kind);
}

// The one place an `Approved` value is made (decision 0003). Callers mint right
// before `writer.apply`, from rows whose hash the latest approval matches.
function mint<K extends SourceKind>(request: WriteRequest<K>): Approved<WriteRequest<K>> {
  return Object.freeze(request) as Approved<WriteRequest<K>>;
}

// The source a mutation writes to: its target's; for a new item, that of the
// create naming it; for a create, the one source whose catalogue has the op.
function kindOf(specs: Specs, m: Draft, all: readonly Draft[]): SourceKind | null {
  if (m.target !== null && !isNewRef(m.target)) return parseItemId(m.target)?.source ?? null;
  if (m.target !== null) {
    const ref = m.target;
    const create = all.find((c) => c.ref === ref);
    return create && create.target === null ? kindOf(specs, create, all) : null;
  }
  const owners = sourceKinds.filter((kind) => hasOp(specs, kind, m.op));
  return owners.length === 1 ? (owners[0] ?? null) : null;
}

function specFor(
  specs: Specs,
  m: Draft,
  all: readonly Draft[],
): { kind: SourceKind; spec: OpSpec } | null {
  const kind = kindOf(specs, m, all);
  if (kind === null || !hasOp(specs, kind, m.op)) return null;
  const spec = catalogueFor(specs, kind).ops[m.op];
  return spec ? { kind, spec } : null;
}

function mustSpec(
  specs: Specs,
  m: Draft,
  all: readonly Draft[],
): { kind: SourceKind; spec: OpSpec } {
  const found = specFor(specs, m, all);
  if (!found) throw new Error(`no catalogue has the op ${m.op} for ${m.target ?? "a new item"}`);
  return found;
}

// Validates each mutation's arguments and its refs, in seq order: only a create
// names a new item, each name once, and a target may name only an item that an
// earlier create in the same change set names. Returns the validated arguments,
// which are what gets stored and replayed.
function check(specs: Specs, drafts: readonly Draft[]): Checked[] {
  const named = new Set<NewRef>();
  return drafts.map((m, i) => {
    const where = `mutation ${i + 1} (${m.op})`;
    if (m.target !== null && isNewRef(m.target) && !named.has(m.target))
      throw new ChangeSetError(
        "invalid",
        `${where}: ${m.target} isn't created by an earlier mutation`,
      );
    const found = specFor(specs, m, drafts);
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

// What a sent row was approved from: its preview's values, without whether
// its item could be read since. Null when it has none.
function approvedFrom(preview: FieldValues | null): FieldValues | null {
  if (preview === null) return null;
  const values = Object.fromEntries(Object.entries(preview).filter(([f]) => f !== goneMark));
  return Object.keys(values).length > 0 ? values : null;
}

// Conflicts in plain words, for the thread and the review page. An `expected`
// of undefined means Oriel is missing a value it recorded at apply (before or
// after), so it can't revert that field safely.
export function explainConflicts(conflicts: readonly Conflict[], specs: Specs): string {
  const parts = conflicts.map((c) => {
    const item = key(c.target);
    const catalogue = catalogueOf(specs, c.target);
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

// Change sets over the writers built from `deps.writerConfig`. A diff reads a
// source's current values through its writer, which knows its field names.
// A source with no writer config reads through `deps.readers`, if it has one
// there: its diffs work, and approving its change sets is refused.
export function changeSets(deps: ChangeSetDeps): ChangeSets {
  const writers = buildWriters(deps.writerConfig, deps.log);
  const unknown = async () => null;
  const sources = Object.fromEntries(
    sourceKinds.flatMap(
      (kind): [SourceKind, { writer: SourceWriter | null; reader: unknown }][] => {
        const writer = writers[kind];
        const person = deps.people?.[kind] ?? unknown;
        if (writer) return [[kind, { writer, reader: { current: writer.current, person } }]];
        const reader = deps.readers?.[kind];
        return reader ? [[kind, { writer: null, reader }]] : [];
      },
    ),
  ) as Sources;
  return changeSetsOver({ ...deps, sources });
}

// The engine, over writers and readers already built. Only `changeSets` and
// tests (with a source in memory) call it; the package entry doesn't export
// it, so production code can't pass a writer in.
export function changeSetsOver(deps: EngineDeps): ChangeSets {
  const { db, specs } = deps;
  const rows = store(db);
  // Change sets this instance is applying. Until an apply returns, every
  // action on its change set is refused as busy (see `busy`), so no mutation
  // is sent twice at once and no edit races the one in flight.
  const applying = new Set<string>();

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

  const sourceOf = (kind: SourceKind): { writer: SourceWriter | null; reader: FieldReader } => {
    const found = deps.sources[kind];
    if (!found) throw new Error(`${kind} items are read-only`);
    return found;
  };
  const reader = (kind: SourceKind): FieldReader => sourceOf(kind).reader;
  // Why a change set can't be approved or applied here: a source it writes
  // to has no writer configured. Null when every one has.
  const unwritable = (set: ChangeSet): string | null => {
    const names = new Set<string>();
    for (const m of set.mutations) {
      if (m.status === "applied") continue;
      const { kind } = mustSpec(specs, m, set.mutations);
      if (deps.sources[kind]?.writer) continue;
      names.add(catalogueFor(specs, kind).name);
    }
    if (names.size === 0) return null;
    return `Writing to ${[...names].join(" and ")} isn't configured here, so this change set can be reviewed but not approved or applied.`;
  };
  const writerOf = (kind: SourceKind): SourceWriter => {
    const { writer } = sourceOf(kind);
    if (!writer)
      throw new ChangeSetError(
        "read-only",
        `Writing to ${catalogueFor(specs, kind).name} isn't configured here.`,
      );
    return writer;
  };

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

    // Each item's fields, and the stable ID it should have, where known.
    const wanted = new Map<
      ItemId,
      { kind: SourceKind; fields: Set<string>; stableId: string | null }
    >();
    for (const m of set.mutations) {
      const item = itemOf(m);
      if (item === null) continue;
      const { kind, spec } = mustSpec(specs, m, set.mutations);
      const entry = wanted.get(item) ?? {
        kind,
        fields: new Set([catalogueFor(specs, kind).titleField]),
        stableId: null,
      };
      entry.stableId ??= m.applied?.item.stableId ?? stableIdFor(m, set, item);
      if (m.status !== "applied" && spec.args(m.args).ok)
        for (const field of Object.keys(spec.after(m.args))) entry.fields.add(field);
      wanted.set(item, entry);
    }
    // Read through the writer where there is one, so an item whose handle
    // names another item now shows as gone: it isn't the item to change. So
    // does one Oriel can't say which item it should be (its handle names no
    // member of the run's region now, as once sync indexes another item
    // under a reused key): reading the handle would show another item.
    const readLive = async (
      item: ItemId,
      {
        kind,
        fields,
        stableId,
      }: { kind: SourceKind; fields: Set<string>; stableId: string | null },
    ): Promise<FieldValues | "gone"> => {
      const { writer } = sourceOf(kind);
      if (!writer) return reader(kind).current(item, [...fields]);
      if (stableId === null) return "gone";
      const found = await writer.read(item, [...fields]);
      return found === "gone" || found.stableId !== stableId ? "gone" : found.values;
    };
    const live = new Map(
      await Promise.all(
        [...wanted].map(async ([item, entry]) => [item, await readLive(item, entry)] as const),
      ),
    );
    const title = async (id: ItemId): Promise<string | null> => {
      const kind = parseItemId(id)?.source;
      if (!kind) return null;
      const field = catalogueFor(specs, kind).titleField;
      const values = live.get(id) ?? (await reader(kind).current(id, [field]));
      return values === "gone" ? null : text(values[field]);
    };

    // Field values per item (or new item's ref) as earlier lines leave them.
    const state = new Map<string, Record<string, unknown>>();
    const lines: Diff["lines"] = [];
    const gone = new Set<Ulid>();
    for (const m of set.mutations) {
      const { kind, spec } = mustSpec(specs, m, set.mutations);
      const catalogue = catalogueFor(specs, kind);
      const context = (subject: Subject, before: FieldValues) => ({
        subject,
        before,
        person: (accountId: string) => reader(kind).person(accountId),
        title,
      });
      const item = itemOf(m);

      // A line Oriel can't describe, and a change it won't send or revert.
      if (!spec.args(m.args).ok) {
        if (!m.applied) gone.add(m.id);
        lines.push({
          mutationId: m.id,
          sentence: `${staleArgs}, so it can't be shown, applied or reverted.`,
          target: m.target,
          fields: [],
        });
        continue;
      }

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
      // A row sent with no answer may have landed, so the source may hold
      // its value already: it shows what the person approved it from.
      const shown = m.status === "failed" ? approvedFrom(m.preview) : null;
      const before = Object.fromEntries(
        Object.keys(after).map((f) => [f, (shown ? shown[f] : values[f]) ?? null]),
      );
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
  // rendering. A sent row keeps the values it was approved from, since what
  // landed may show now; only whether its item can be read changes.
  const keepPreview = (set: ChangeSet, rendered: { diff: Diff; gone: Set<Ulid> }): void =>
    transaction(db, () => {
      const now = rows.load(set.id);
      if (!now || now.hash !== set.hash || now.decision?.kind === "approved") return;
      const open = new Map(
        now.mutations.filter((m) => m.status !== "applied").map((m) => [m.id, m]),
      );
      for (const line of rendered.diff.lines) {
        const m = open.get(line.mutationId);
        if (!m) continue;
        const gone = rendered.gone.has(line.mutationId);
        const shown = Object.fromEntries(line.fields.map((f) => [f.name, f.before]));
        const kept = m.status === "failed" ? approvedFrom(m.preview) : null;
        const values = kept ?? (gone ? {} : shown);
        rows.setPreview(line.mutationId, gone ? { ...values, [goneMark]: true } : values);
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
      const catalogue = catalogueOf(specs, item);
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
      const current = await writerOf(kind).current(item, [...fields.keys()]);
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
    const field = catalogueFor(specs, kind).updatedField;
    const expected = last.applied.after[field];
    const current = await writerOf(kind).current(item, [field]);
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
    if (!mustSpec(specs, original, originalSet.mutations).spec.creates)
      return conflictsWith([original]);
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
  // it or that the mutation undoes, or else as the region its run used
  // resolves the handle, as capture did. Null when the handle names no member
  // of that region any more, such as a key another item has taken since.
  const stableIdFor = (m: MutationRecord, set: ChangeSet, target: ItemId): string | null => {
    if (m.target !== null && isNewRef(m.target)) {
      const ref = m.target;
      return set.mutations.find((c) => c.ref === ref)?.applied?.item.stableId ?? null;
    }
    if (m.reverts) return rows.mutation(m.reverts)?.applied?.item.stableId ?? null;
    const region = rows.region(set.runId, set.workspaceId);
    return region.has(target) ? region.stableId(target) : null;
  };

  // Why a mutation's target may no longer be written: it left the thread's
  // group after the change was captured (decision 0018). A revert may target
  // anything the change set it reverts touched, and an item this change set
  // created is its own, so neither is checked.
  const leftGroup = (m: MutationRecord, set: ChangeSet, target: ItemId | null): string | null => {
    if (target === null || m.reverts !== null || (m.target !== null && isNewRef(m.target)))
      return null;
    const source = parseItemId(target)?.source;
    const stableId = stableIdFor(m, set, target);
    if (!source || stableId === null || rows.inGroupNow(set.threadId, source, stableId))
      return null;
    return `${key(target)} was removed from the group after this was captured, so it wasn't sent.`;
  };

  // Whether a set op's value is already in place, as when an earlier send
  // landed but its answer was lost: the result to record without sending;
  // "absent" when its own item was read and holds something else; "unknown"
  // when Oriel couldn't tell (the item can't be read, or its handle names
  // another item now, or Oriel doesn't know which item it should be). The
  // result's `before` leaves the field out. Oriel can't know whether the
  // value is its own write or someone else's, so a revert can't put it back.
  const inPlace = async (
    m: MutationRecord,
    set: ChangeSet,
    kind: SourceKind,
    spec: OpSpec,
    target: ItemId,
  ): Promise<{ applied: AppliedValue } | "absent" | { unknown: string }> => {
    const after = spec.after(m.args);
    const fields = Object.keys(after);
    const updated = catalogueFor(specs, kind).updatedField;
    const stableId = stableIdFor(m, set, target);
    if (stableId === null)
      return { unknown: `${key(target)} no longer names an item in the region it was made in` };
    // A read that fails tells nothing either, and says why. A bug in Oriel
    // (a RangeError, say) isn't the source's answer, and throws.
    const found = await writerOf(kind)
      .read(target, [...fields, updated])
      .catch((error: unknown) => {
        if (error instanceof RangeError || error instanceof SyntaxError) throw error;
        return { failed: message(error) };
      });
    if (found === "gone") return { unknown: `${key(target)} can't be read` };
    if ("failed" in found) return { unknown: `reading ${key(target)} failed: ${found.failed}` };
    if (found.stableId !== stableId) return { unknown: `${key(target)} names another item now` };
    const current = found.values;
    if (!fields.every((f) => Object.hasOwn(current, f) && sameValue(current[f], after[f])))
      return "absent";
    return {
      applied: {
        item: { id: target, stableId },
        before: {},
        after: Object.fromEntries(
          [...fields, updated].filter((f) => Object.hasOwn(current, f)).map((f) => [f, current[f]]),
        ),
        at: deps.now(),
      },
    };
  };

  // Once every change in a set has applied, by whichever path, records when
  // and says so, once.
  const complete = (id: string): void => {
    const { now } = at();
    if (!rows.markCompleted(id as Ulid, now)) return;
    const set = mustLoad(id);
    deps.emit({
      name: "changeset.applied",
      at: now,
      workspaceId: set.workspaceId,
      changeSetId: set.id,
      threadId: set.threadId,
    });
  };

  const hasWriter = (kind: SourceKind) => Boolean(deps.sources[kind]?.writer);

  // Guards. Each action has one: whether it may run on the change set as it
  // stands now, and if not, why. The action calls its own guard first, and
  // `nextSteps` offers exactly the actions whose guard passes, so nothing it
  // offers is refused and nothing refused is offered.
  type Refusal = {
    code: ChangeSetErrorCode;
    message: string;
    // The row apply stopped at, when the row's own record doesn't say why
    // already: apply records the message on it.
    stop?: Ulid;
    // That row was sent before, and has just been found not in place: it is
    // unsent again.
    unsent?: true;
  };
  const refuse = (refusal: Refusal): never => {
    throw new ChangeSetError(refusal.code, refusal.message);
  };

  // While this instance applies a change set, every action on it waits: no
  // edit can race the row in flight, and the apply records completion.
  const busy = (set: ChangeSet): Refusal | null =>
    applying.has(set.id)
      ? { code: "busy", message: "this change set is being applied; try again once that ends" }
      : null;

  // A rejected or dismissed change set is decided for good: nothing more of
  // it applies and its rows don't change. Only reverting what it applied is
  // left.
  const decided = (set: ChangeSet): Refusal | null =>
    set.decision?.kind === "rejected"
      ? {
          code: "refused",
          message: "this change set was rejected or dismissed, so it can't change any more",
        }
      : null;

  const readOnly = (set: ChangeSet): Refusal | null => {
    const why = unwritable(set);
    return why === null ? null : { code: "read-only", message: why };
  };

  const mayHaveLanded = (source: string) =>
    `This may already be in ${source}: check, then dismiss what is left of this change set.`;

  // Why a row that was sent can't be sent again yet, or null: a create or a
  // link may have landed and is never sent twice, and a set op's send may
  // still be on its way until its lease runs out. The row's own record (a
  // send's mark) already says so, so nothing is recorded over it.
  const sentAndWaiting = (m: MutationRecord, set: ChangeSet): Refusal | null => {
    if (m.status !== "failed") return null;
    const { kind, spec } = mustSpec(specs, m, set.mutations);
    if (!spec.idempotent)
      return { code: "refused", message: mayHaveLanded(catalogueFor(specs, kind).name) };
    const sentAt = m.error === null ? null : sendMark.exec(m.error)?.[1];
    if (!sentAt || at().ms >= Date.parse(sentAt) + sendLeaseMs) return null;
    return {
      code: "refused",
      message: `Oriel sent this at ${sentAt} and has no answer yet; it may still be on its way. Try again after ${instant(new Date(Date.parse(sentAt) + sendLeaseMs))}.`,
    };
  };

  // Where apply would send a row now, or why it wouldn't, short of reading
  // the source. Apply checks each row with this before sending it, and its
  // guard checks the first unapplied one. A set op sent before may have
  // landed: apply first checks whether it is in place (`checked`), and
  // records it if so, whatever the group or region holds now. Only then do
  // those stop it; and it is unsent again only if it was found absent.
  const sendPlan = (
    m: MutationRecord,
    set: ChangeSet,
    checked: "no" | "absent" | "unknown" = "no",
  ): { refusal: Refusal } | { target: ItemId | null; stableId: string | null } => {
    const { kind, spec } = mustSpec(specs, m, set.mutations);
    if (!hasWriter(kind))
      return {
        refusal: {
          code: "read-only",
          message: `Writing to ${catalogueFor(specs, kind).name} isn't configured here.`,
        },
      };
    const waiting = sentAndWaiting(m, set);
    if (waiting) return { refusal: waiting };
    const sentBefore = m.status === "failed";
    const stop = (message: string) => ({
      refusal: {
        code: "refused" as const,
        message,
        stop: m.id,
        ...(sentBefore && checked === "absent" ? { unsent: true as const } : {}),
      },
    });
    // Arguments stored before the source's catalogue tightened may no longer
    // pass it; nothing is sent on them.
    if (!spec.args(m.args).ok) return stop(`${staleArgs}, so it wasn't sent.`);
    // Approval records what the diff showed; apply needs it.
    if (m.preview === null)
      return stop(
        "This hasn't been shown in a diff since the last edit, so it wasn't sent. Review the diff, then approve it.",
      );
    if (m.preview[goneMark] === true)
      return stop(
        `${key(m.target ?? "the new item")} couldn't be read when this was last reviewed, so it wasn't sent. Review it again once it can be read.`,
      );
    const where = resolve(m, set);
    if ("failed" in where) return stop(where.failed);
    // The writer refuses a target whose handle names another item by now.
    const stableId = where.target === null ? null : stableIdFor(m, set, where.target);
    if (sentBefore && spec.idempotent && where.target !== null && checked === "no")
      return { target: where.target, stableId };
    if (where.target !== null && stableId === null)
      return stop(
        `${key(where.target)} no longer names an item in the region this change was made in, so it wasn't sent.`,
      );
    const away = leftGroup(m, set, where.target);
    if (away) return stop(away);
    return { target: where.target, stableId };
  };

  // Apply, and retry: approved as it stands, writable, something left to
  // apply, and its next change can be sent.
  const applyRefusal = (set: ChangeSet): Refusal | null => {
    const first = set.mutations.find((m) => m.status !== "applied");
    const refusal =
      busy(set) ??
      readOnly(set) ??
      (set.decision?.kind === "approved"
        ? null
        : {
            code: "not-approved" as const,
            message: "this change set isn't approved as it stands; review the diff and approve it",
          }) ??
      (first ? null : { code: "refused" as const, message: "every change in it has applied" });
    if (refusal || !first) return refusal;
    const plan = sendPlan(first, set);
    return "refusal" in plan ? plan.refusal : null;
  };

  // Approve, and approve the rest: undecided, writable, every change still to
  // apply shown in a diff since the last edit and none of them shown as gone
  // or stale, and the next one not waiting on an earlier send.
  const approveRefusal = (set: ChangeSet): Refusal | null => {
    const open = set.mutations.filter((m) => m.status !== "applied");
    const [first] = open;
    const refused = (message: string): Refusal => ({ code: "refused", message });
    const pre =
      busy(set) ??
      decided(set) ??
      (set.decision?.kind === "approved" ? refused("this change set is already approved") : null) ??
      (first ? null : refused("every change in it has applied; nothing is left to approve")) ??
      readOnly(set);
    if (pre || !first) return pre;
    const stale = open.find((m) => !mustSpec(specs, m, set.mutations).spec.args(m.args).ok);
    if (stale)
      return refused(
        `mutation ${stale.seq} (${stale.op}): ${staleArgs.toLowerCase()}; leave it out, or reject the change set`,
      );
    const unseen = open.find((m) => m.preview === null);
    if (unseen)
      return refused(
        `mutation ${unseen.seq} hasn't been shown in a diff since the last edit; review the diff, then approve`,
      );
    const gone = open.find((m) => m.preview?.[goneMark] === true);
    if (gone)
      return refused(
        `${key(gone.target ?? "the new item")} couldn't be read when this was last reviewed; it can be approved once it can be read again`,
      );
    return sentAndWaiting(first, set);
  };

  // Reject: declines a change set before anything of it landed, or may have.
  const rejectRefusal = (set: ChangeSet): Refusal | null => {
    const refused = (message: string): Refusal => ({ code: "refused", message });
    return (
      busy(set) ??
      decided(set) ??
      (set.mutations.some((m) => m.status === "applied")
        ? refused("part of this change set has applied; dismiss what is left instead")
        : null) ??
      (set.mutations.some((m) => m.status === "failed")
        ? refused("a change in it was sent and may have landed; dismiss it instead")
        : null)
    );
  };

  // Edit, and remove: rows left out or given new arguments. Returns the
  // validated arguments of the rows edited, or why not. Leaving rows out of
  // a change set that is approved and hasn't stopped waits until it has.
  const editGuard = (
    set: ChangeSet,
    remove: ReadonlySet<Ulid>,
    changes: ReadonlyMap<Ulid, unknown>,
  ): { refusal: Refusal } | { edited: { id: Ulid; args: unknown }[] } => {
    const pre = busy(set) ?? decided(set);
    if (pre) return { refusal: pre };
    const refused = (code: ChangeSetErrorCode, message: string) => ({
      refusal: { code, message },
    });
    for (const mutationId of [...remove, ...changes.keys()]) {
      const m = set.mutations.find((r) => r.id === mutationId);
      if (!m) return refused("not-found", `no mutation ${mutationId} in this change set`);
      if (m.status === "applied")
        return refused("refused", `mutation ${m.seq} is already applied and can't be edited`);
      // A revert puts back what was there; changing a row of it would write
      // something else under that name. Rows can only be removed.
      if (m.reverts !== null && changes.has(mutationId))
        return refused(
          "refused",
          `mutation ${m.seq} undoes an earlier change: remove it from the revert instead of editing it`,
        );
      // A sent row may have landed: it can be removed, never changed.
      if (m.status === "failed" && changes.has(mutationId))
        return refused(
          "refused",
          `mutation ${m.seq}: this change may already be in ${catalogueFor(specs, mustSpec(specs, m, set.mutations).kind).name}: check, then remove it`,
        );
      if (remove.has(mutationId) && changes.has(mutationId))
        return refused("invalid", `mutation ${m.seq} is both removed and changed`);
    }
    const stopped = set.mutations.some((m) => m.status !== "applied" && m.error !== null);
    if (remove.size > 0 && set.decision?.kind === "approved" && !stopped)
      return refused(
        "refused",
        "this change set is approved and ready to apply; apply it, or reject it, before leaving changes out",
      );
    const kept = set.mutations.filter((m) => !remove.has(m.id));
    if (kept.length === 0)
      return refused("invalid", "an edit can't leave a change set with no changes");
    let checked: Checked[];
    try {
      checked = check(
        specs,
        kept.map((m) => ({ ...m, args: changes.has(m.id) ? changes.get(m.id) : m.args })),
      );
    } catch (error) {
      if (error instanceof ChangeSetError) return refused(error.code, error.message);
      throw error;
    }
    // Targets don't change in an edit, and a revert's may be items it
    // created, so only the edited arguments are held to the region.
    const edited = kept.flatMap((row, i) => {
      const m = checked[i];
      return m && changes.has(row.id) ? [{ id: row.id, seq: row.seq, m }] : [];
    });
    if (edited.length > 0) {
      const region = rows.region(set.runId, set.workspaceId);
      const outside = outsideRegion(edited, (handle) => region.has(handle), false);
      if (outside) return refused("refused", outside);
    }
    return { edited: edited.map(({ id, m }) => ({ id, args: m.args })) };
  };

  // Dismiss: ends a change set that started landing, or may have. One that
  // nothing landed from is rejected instead.
  // A set already rejected or dismissed is "done": dismissing it again
  // changes nothing, and it isn't offered.
  const dismissRefusal = (set: ChangeSet): Refusal | "done" | null => {
    const refused = (message: string): Refusal => ({ code: "refused", message });
    return (
      busy(set) ??
      (set.decision?.kind === "rejected" ? "done" : null) ??
      (set.mutations.every((m) => m.status === "applied")
        ? refused("every change in this change set has applied; nothing is left to dismiss")
        : null) ??
      (set.mutations.some((m) => m.status !== "pending")
        ? null
        : refused("nothing in this change set has landed or been sent; reject it instead"))
    );
  };

  // Revert: something applied and each applied change can be undone; nothing
  // sent and unanswered, unless the rest was dismissed, since then the revert
  // covers exactly what applied; and no revert of it already, whether under
  // way or one that undid part of it before it was dismissed (the items no
  // longer hold what this applied, so a second revert could only conflict).
  const revertRefusal = (set: ChangeSet, reverts: readonly ChangeSet[]): Refusal | null => {
    const pre = busy(set);
    if (pre) return pre;
    const refused = (message: string): Refusal => ({ code: "not-revertible", message });
    if (set.revertOf !== null) return refused("this change set is itself a revert");
    const applied = set.mutations.filter((m) => m.applied !== null);
    if (applied.length === 0) return refused("nothing in this change set has been applied");
    const sent = set.mutations.find((m) => m.status === "failed");
    if (sent && set.decision?.kind !== "rejected")
      return refused(
        `mutation ${sent.seq} (${sent.op}) was sent and may have landed in ${catalogueFor(specs, mustSpec(specs, sent, set.mutations).kind).name}, so this change set can't be reverted until the rest of it is dismissed`,
      );
    if (
      reverts.some(
        (other) =>
          other.decision?.kind !== "rejected" || other.mutations.some((m) => m.applied !== null),
      )
    )
      return { code: "refused", message: "this change set has been reverted already" };
    // Items it created: everything it did to one is undone by deleting it.
    const created = new Map<ItemId, MutationRecord>();
    for (const m of applied) {
      const { kind, spec } = mustSpec(specs, m, set.mutations);
      if (!hasWriter(kind))
        return {
          code: "read-only",
          message: `Writing to ${catalogueFor(specs, kind).name} isn't configured here.`,
        };
      if (!spec.args(m.args).ok)
        return refused(
          `mutation ${m.seq} (${m.op}) is not revertible: stored arguments no longer valid`,
        );
      if (spec.creates && m.applied) created.set(m.applied.item.id, m);
    }
    for (const m of applied) {
      if (!m.applied) continue;
      const create = created.get(m.applied.item.id);
      if (create && create !== m) continue;
      const step = mustSpec(specs, m, set.mutations).spec.undo(m.args, m.applied);
      if ("refused" in step)
        return refused(`mutation ${m.seq} (${m.op}) can't be reverted: ${step.refused}`);
      // What it would put back must pass the catalogue as it is now.
      const kind = parseItemId(m.applied.item.id)?.source;
      const back =
        kind && hasOp(specs, kind, step.op) ? catalogueFor(specs, kind).ops[step.op] : undefined;
      if (!back?.args(step.args).ok)
        return refused(
          `mutation ${m.seq} (${m.op}) can't be reverted: what it would put back is no longer a valid change`,
        );
    }
    return null;
  };

  // A change that was sent and got no answer may be in its source already.
  // Each warning names where to look.
  const warningsOf = (set: ChangeSet): string[] =>
    set.mutations.flatMap((m) => {
      if (m.status !== "failed") return [];
      const { kind, spec } = mustSpec(specs, m, set.mutations);
      const catalogue = catalogueFor(specs, kind);
      const where = resolve(m, set);
      const target = "failed" in where ? null : where.target;
      const title = spec.args(m.args).ok ? text(spec.after(m.args)[catalogue.titleField]) : null;
      const what =
        target !== null
          ? key(target)
          : title !== null
            ? `for “${title}”`
            : "for the item it creates";
      return [`This may already be in ${catalogue.name}: check ${what}`];
    });

  // Exactly the actions whose guards pass, in the order a person reads them.
  const stepsOf = (set: ChangeSet, reverts: readonly ChangeSet[]): NextStep[] => {
    const steps: NextStep[] = [];
    if (!approveRefusal(set))
      steps.push({
        kind: set.mutations.some((m) => m.status === "applied") ? "approve-rest" : "approve",
      });
    if (!applyRefusal(set)) steps.push({ kind: "retry" });
    if (!rejectRefusal(set)) steps.push({ kind: "reject" });
    const removable = set.mutations
      .filter((m) => m.status !== "applied")
      .filter((m) => "edited" in editGuard(set, new Set([m.id]), new Map()))
      .map((m) => m.id);
    if (removable.length) steps.push({ kind: "remove", mutationIds: removable });
    if (!dismissRefusal(set)) steps.push({ kind: "dismiss", warnings: warningsOf(set) });
    if (!revertRefusal(set, reverts)) steps.push({ kind: "revert" });
    return steps;
  };

  const revertsOf = (set: ChangeSet): ChangeSet[] =>
    rows.revertsOf(set.id).flatMap((id) => rows.load(id) ?? []);

  // Sends unapplied mutations in seq order and stops at the first failure, so
  // a retry can't land a later mutation before an earlier one. Every write is
  // marked sent (failed, until its result is recorded) before it goes out, so
  // a crash mid-send leaves that on record. Every write to a row compares the
  // row's version it read, so of two instances only one can mark or record a
  // send, and a conclusion drawn before an await is dropped if anything wrote
  // to the row meanwhile. A stop before sending
  // leaves the row's status as it was, says why, and is checked again next
  // time. A sent set op is retried once its lease runs out, since it is
  // idempotent and one already in place is recorded without sending; a sent
  // create or link is never sent again. A row already sent when the pass
  // began never records a `before` for the fields it writes: an earlier send
  // may have landed, so the source's "before" may be Oriel's own value, and a
  // revert must report that rather than restore it. The caller has checked
  // `applyRefusal`.
  const applyOnce = async (id: string): Promise<ApplyReport> => {
    const first = mustLoad(id);
    const report: ApplyReport = { changeSetId: first.id, applied: [], skipped: [], failed: [] };
    // Stops before sending, recording why on the row (over the version
    // `from`) unless its own record says so already. A row found absent goes
    // back to unsent only if nothing wrote to it since the read that found it
    // so: `from` is the row as that read began.
    const stopAt = (mutationId: Ulid, refusal: Refusal, from: { version: number }): ApplyReport => {
      if (refusal.stop && refusal.unsent)
        rows.markRefused(refusal.stop, from, "pending", refusal.message);
      else if (refusal.stop) rows.markStopped(refusal.stop, from, refusal.message);
      report.failed.push({ mutationId, error: refusal.message });
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
      // The row as this pass first read it, before any await.
      const seen = { version: m.version };
      const wasSent = m.status === "failed";
      const { kind, spec } = mustSpec(specs, m, set.mutations);
      const source = catalogueFor(specs, kind).name;
      let plan = sendPlan(m, set);
      if ("refusal" in plan) return stopAt(mutationId, plan.refusal, seen);
      const writes = Object.keys(spec.after(m.args));
      // A write that already landed is recorded. Found absent from its own
      // item, an earlier send of it is known not to have landed; if Oriel
      // couldn't tell, it may have, so it isn't sent again.
      let inPlaceFound: "no" | "absent" | "unknown" = "no";
      if (spec.idempotent && plan.target !== null) {
        const result = await inPlace(m, set, kind, spec, plan.target);
        if (typeof result === "object" && "applied" in result) {
          ({ m } = approved(id, mutationId));
          if (!m) continue;
          rows.markApplied(mutationId, m, result.applied);
          report.applied.push(mutationId);
          continue;
        }
        inPlaceFound = typeof result === "object" ? "unknown" : result;
        if (wasSent && typeof result === "object")
          return stopAt(
            mutationId,
            {
              code: "refused",
              message: `Oriel couldn't tell whether ${key(plan.target)} already holds this: ${result.unknown}. It may already be in ${source}, so it wasn't sent again.`,
              stop: mutationId,
            },
            seen,
          );
      }
      if (m.reverts) {
        const checking = await recheck(m.reverts).then(
          (conflicts) => ({ conflicts }),
          (error: unknown) => ({ failed: message(error) }),
        );
        if ("failed" in checking)
          return stopAt(
            mutationId,
            {
              code: "refused",
              message: `Oriel couldn't read the item to check nobody changed it since, so this wasn't sent: ${checking.failed}`,
              stop: mutationId,
            },
            seen,
          );
        const { conflicts } = checking;
        if (conflicts.length)
          return stopAt(
            mutationId,
            { code: "refused", message: explainConflicts(conflicts, specs), stop: mutationId },
            seen,
          );
      }

      // Every await is behind us: from this check to the write nothing awaits,
      // so the rows whose hash matched the approval are the rows sent.
      ({ set, m } = approved(id, mutationId));
      if (!m) continue;
      if (m.status === "applied") {
        report.skipped.push(mutationId);
        continue;
      }
      plan = sendPlan(m, set, inPlaceFound);
      if ("refusal" in plan)
        return stopAt(mutationId, plan.refusal, plan.refusal.unsent ? seen : m);
      const request = mint({
        mutationId: m.id,
        op: m.op,
        target: plan.target,
        expectedStableId: plan.stableId,
        args: m.args,
      });
      const uncertain = mayHaveLanded(source);
      const notice = spec.idempotent
        ? `Sent to ${source}, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again.`
        : uncertain;
      const mark = `${notice} (sent ${at().now})`;
      // Only from the row as this pass first read it: if another apply sent it
      // meanwhile, its send isn't repeated and its mark isn't reset.
      const sentVersion = rows.markSent(mutationId, seen, mark);
      if (sentVersion === null) {
        report.failed.push({
          mutationId,
          error: "Another apply is sending this change right now, so it wasn't sent again.",
        });
        return report;
      }
      // The row as marking it left it: recording the send's result compares it.
      const sent = { version: sentVersion };
      const unanswered = (error: string): ApplyReport => {
        rows.markFailed(mutationId, sent, error);
        report.failed.push({ mutationId, error });
        return report;
      };
      const unsure = spec.idempotent ? "" : ` ${uncertain}`;
      let result: unknown;
      try {
        result = await writerOf(kind).apply(request);
      } catch (error) {
        const said = `${message(error).replace(/\.$/, "")}.`;
        // Nothing landed: the source changed nothing, or the write was never
        // sent. The row is unsent again, unless an earlier send of it went
        // unchecked and may still be there.
        if (error instanceof SourceRefused) {
          const why = error.sent ? said : `${notSent}${said}`;
          rows.markRefused(
            mutationId,
            sent,
            wasSent && inPlaceFound !== "absent" ? "failed" : "pending",
            why,
          );
          report.failed.push({ mutationId, error: why });
          return report;
        }
        return unanswered(`${said}${unsure}`);
      }
      const checked = writeResult(result);
      if (!checked.ok) {
        return unanswered(
          `The source answered in a shape Oriel can't read: ${JSON.stringify(checked.issues)}.${unsure}`,
        );
      }
      const before = wasSent
        ? Object.fromEntries(
            Object.entries(checked.value.before).filter(([f]) => !writes.includes(f)),
          )
        : checked.value.before;
      rows.markApplied(mutationId, sent, { ...checked.value, before, at: deps.now() });
      report.applied.push(mutationId);
    }

    complete(id);
    return report;
  };

  // The live link a review-link decision comes through, checked: minted for
  // this change set, and with a typed name. Null for one in the thread.
  const linkOf = (id: string, who: Approver, by: string): LinkRow | null => {
    if (who.via !== "review-link") return null;
    const link = liveLink(who.token);
    if (!link || link.change_set_id !== id)
      throw new ChangeSetError("refused", "this review link isn't live for this change set");
    if (by === "")
      throw new ChangeSetError("refused", "type your name to decide through a review link");
    return link;
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
      const checked = check(specs, parsed.value);
      const revertOnly = checked.findIndex((m) => m.spec.revertOnly);
      if (revertOnly >= 0)
        throw new ChangeSetError(
          "invalid",
          `mutation ${revertOnly + 1} (${checked[revertOnly]?.op}): exists only to revert a change, so a run can't ask for it`,
        );
      const region = rows.region(owner.value.id, owner.value.workspaceId);
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

    async get(id) {
      return rows.load(id);
    },

    async ofThread(threadId) {
      return rows.ofThread(threadId).flatMap((id) => rows.load(id) ?? []);
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
        const guarded = editGuard(current, remove, changes);
        if ("refusal" in guarded) return refuse(guarded.refusal);
        for (const mutationId of remove) rows.remove(current.id, mutationId);
        for (const { id: mutationId, args } of guarded.edited)
          rows.setArgs(current.id, mutationId, args);
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
      // Leaving out the last unapplied change completes the set.
      if (!changed.unchanged) complete(id);
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
        const link = linkOf(id, who.value, by);
        const current = mustLoad(id);
        if (current.hash !== reviewed) {
          throw new ChangeSetError(
            "stale",
            "this change set changed after you reviewed it; review the new diff",
          );
        }
        const refusal =
          decision.value === "approved" ? approveRefusal(current) : rejectRefusal(current);
        if (refusal) refuse(refusal);
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
      const set = mustLoad(id);
      const refusal = applyRefusal(set);
      if (refusal) {
        // A stop says why on the row, as one partway through would.
        const row = set.mutations.find((m) => m.id === refusal.stop);
        if (row) rows.markStopped(row.id, row, refusal.message);
        refuse(refusal);
      }
      applying.add(id);
      try {
        return await applyOnce(id);
      } finally {
        applying.delete(id);
      }
    },

    applying(id) {
      return applying.has(id);
    },

    // Reverses exactly what has been applied (see `revertRefusal`). A partly
    // applied change set that wasn't dismissed loses its unsent rows in the
    // same transaction, so nothing more of it can land; that voids its
    // approval. A dismissed one keeps its rows, and with them what its
    // dismissal said may have landed.
    async revert(id) {
      const set = mustLoad(id);
      const refusal = revertRefusal(set, revertsOf(set));
      if (refusal) refuse(refusal);
      const applied = set.mutations.filter((m) => m.applied !== null);

      // Items this change set created. Everything it did to one is undone by
      // deleting it, once.
      const created = new Map<ItemId, MutationRecord>();
      for (const m of applied)
        if (m.applied && mustSpec(specs, m, set.mutations).spec.creates)
          created.set(m.applied.item.id, m);

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
        const step = mustSpec(specs, m, set.mutations).spec.undo(m.args, m.applied);
        // The guard found every one undoable.
        if ("refused" in step) throw new Error(`mutation ${m.id} can't be undone: ${step.refused}`);
        undo.push({ reverts: m.id, op: step.op, target: item, ref: null, args: step.args });
      }
      const checked = check(specs, undo);
      const reverseId = ulid(at().ms);
      transaction(db, () => {
        // Nothing may have been sent, landed or started since the plan was made.
        const now = mustLoad(set.id);
        const again = revertRefusal(now, revertsOf(now));
        if (again) refuse(again);
        const appliedNow = now.mutations.filter((m) => m.applied !== null).map((m) => m.id);
        if (appliedNow.join() !== applied.map((m) => m.id).join())
          throw new ChangeSetError(
            "busy",
            "more of this change set applied while the revert was being made; revert it again",
          );
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
        if (now.decision?.kind !== "rejected")
          for (const m of now.mutations) if (m.applied === null) rows.remove(now.id, m.id);
      });
      deps.emit({
        name: "changeset.reverted",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
        conflicts: 0,
      });
      // Dropping the unsent rows may leave every remaining one applied.
      complete(set.id);
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

    // The review route sends `Referrer-Policy: no-referrer` and
    // `Cache-Control: no-store`, and calls this only on an explicit POST,
    // never on the GET a link unfurler makes: it reads the source and records
    // previews.
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

    async nextSteps(id) {
      const set = mustLoad(id);
      return stepsOf(set, revertsOf(set));
    },

    // Rejects what hasn't applied, as the set stands, and says what may have
    // landed anyway. What did apply stays, and a revert covers exactly that.
    // Dismissing a change set already rejected or dismissed changes nothing.
    async dismiss(id, approver = { via: "thread", by: "user" }, reviewed) {
      const who = approverValue(approver, "$.approver");
      if (!who.ok) throw invalid("approver", who.issues);
      if (reviewed !== undefined && typeof reviewed !== "string")
        throw new ChangeSetError("invalid", "reviewed must be a hash");
      const by = who.value.by.trim();
      const result = transaction(db, () => {
        const link = linkOf(id, who.value, by);
        const current = mustLoad(id);
        const refusal = dismissRefusal(current);
        if (refusal === "done") return { set: current, dismissed: false };
        if (refusal) refuse(refusal);
        if (reviewed !== undefined && current.hash !== reviewed)
          throw new ChangeSetError(
            "stale",
            "this change set changed after you reviewed it; review the new diff",
          );
        const { now, ms } = at();
        rows.insertDecision({
          id: ulid(ms),
          workspaceId: current.workspaceId,
          changeSetId: current.id,
          kind: "rejected",
          via: who.value.via,
          reviewLink: link?.token_hash ?? null,
          by,
          hash: current.hash,
          at: now,
        });
        rows.revokeLinks(current.id, now);
        return { set: current, dismissed: true };
      });
      // Not a rejection: the person didn't decline the change; the source
      // stopped it partway.
      if (result.dismissed)
        deps.emit({
          name: "changeset.dismissed",
          at: deps.now(),
          workspaceId: result.set.workspaceId,
          changeSetId: result.set.id,
          via: who.value.via,
        });
      return { changeSet: mustLoad(id), warnings: warningsOf(result.set) };
    },
  };
}

// How fetch says a request got no answer: the connection failed or timed out.
const unheard =
  /^(?:fetch failed|The operation was aborted due to timeout|This operation was aborted)\.?(?: ([\s\S]*))?$/;

// How apply stores a write that was never sent: a read or a check before it
// failed.
const notSent = "Nothing was sent: ";
// A request and how the source answered it, as the writer reports one.
const answer =
  /^(GET|PUT|POST|DELETE) \S+: (?:(\d{3})|unexpected response \([^)]*\))\.?(?: ([\s\S]*))?$/;

// Why a write that was never sent failed, as a person reads it.
function plainUnsent(why: string): string {
  if (unheard.test(why))
    return "Oriel couldn't reach the source before sending this, so nothing was sent.";
  const read = answer.exec(why);
  if (read?.[1] !== "GET") return `${notSent}${why}`;
  const [, , status, said = ""] = read;
  const first = "Oriel couldn't read the item before sending this, so nothing was sent";
  if (status === undefined) return `${first}: the source answered in a shape Oriel can't read.`;
  return said.trim() ? `${first}: ${said.trim()}` : `${first} (the source answered ${status}).`;
}

// A reason a change stopped, as a person reads it. A source's answer, as
// apply stores it ("PUT /rest/…: 400 What it said."), loses its request line
// and status code and keeps what the source said; a send that got no answer
// says so; a write never sent says so, and why; a send's mark (when it was
// sent, and its nonce) is Oriel's bookkeeping and goes. Oriel's own reasons
// are already plain.
export function plainError(error: string): string {
  const bare = error.replace(sendMark, "");
  if (bare.startsWith(notSent)) return plainUnsent(bare.slice(notSent.length));
  const lost = unheard.exec(bare);
  if (lost) return ["Oriel sent this and didn't hear back.", lost[1]].filter(Boolean).join(" ");
  const answered = /^(?:GET|PUT|POST|DELETE) \S+: (\d{3})\.?(?: ([\s\S]*))?$/.exec(bare);
  if (!answered) return bare;
  const [, status = "", said = ""] = answered;
  // Only a 4xx is a refusal; a source that broke while writing may have written.
  const what = status.startsWith("4")
    ? "The source refused this change"
    : "The source ran into a problem with this change";
  return said.trim() ? `${what}: ${said.trim()}` : `${what} (it answered ${status}).`;
}
