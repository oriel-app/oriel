import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type ApplyReport,
  type Approved,
  type Approver,
  array,
  type CapturedMutation,
  type ChangeRead,
  type ChangeSet,
  type ChangeSetPatch,
  type ChangeSets,
  type Conflict,
  type Decision,
  type Diff,
  type FieldReader,
  type FieldValues,
  type Instant,
  instant,
  type ItemId,
  isItemId,
  isNewRef,
  isPrefix,
  kindOf,
  type Issue,
  type Known,
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
  refine,
  orielRunModel,
  type RunRef,
  type SourceKind,
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

export type { FieldReader };

export type ChangeSetDeps = {
  db: DatabaseSync;
  // Change sets build the writers: nothing passes a writer in, so none exists outside this package.
  writerConfig: WriterConfig;
  names?: { [K in SourceKind]?: (id: string) => Promise<string | null> };
  readers?: { [K in SourceKind]?: FieldReader<K> };
  specs: Specs;
  reviewBase: URL;
  now: () => Instant;
  emit: (event: TelemetryEvent) => void;
  log: Log;
};

export type Sources = {
  [K in SourceKind]?: { writer: SourceWriter<K> | null; reader: FieldReader<K> };
};

export type EngineDeps = Omit<ChangeSetDeps, "writerConfig" | "names" | "readers" | "log"> & {
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
  | "read-only";

export class ChangeSetError extends Error {
  readonly code: ChangeSetErrorCode;
  constructor(code: ChangeSetErrorCode, message: string) {
    super(message);
    this.name = "ChangeSetError";
    this.code = code;
  }
}

// A source with no entry is read-only: no change set can touch its items.
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
// Until then no other apply sends that row again, so a slow write can't land after a later one.
// A crashed send blocks its row this long.
export const sendLeaseMs = 5 * 60 * 1000;
// Well inside a send's lease, so the apply ends, and Try again and Dismiss show, before the window would see it
// stalled, and no send of it is still going after.
export const writeLimitMs = 2 * 60 * 1000;
const sendMark = / \(sent (\S+)\)$/;
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const maxErrorChars = 500;
// No catalogue field starts with "$".
const goneMark = "$gone";
const refusedMark = "$refused";
const staleArgs = "This change's stored arguments are no longer valid";

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
  into: optional(
    refine(string, (kind) => isPrefix(kind) && !kind.includes("."), "expected a kind"),
  ),
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
  const kind = parseItemId(item)?.kind;
  if (!kind) throw new Error(`not an item ID: ${item}`);
  return catalogueFor(specs, kind);
}

// The one place an `Approved` value is made. Callers mint right before `writer.apply`, from rows whose hash the
// latest approval matches.
function mint<K extends SourceKind>(request: WriteRequest<K>): Approved<WriteRequest<K>> {
  return Object.freeze(request) as Approved<WriteRequest<K>>;
}

// One captured before two kinds' catalogues shared an op has no kind: it is the first declared kind whose catalogue has its op.
type Owner = { kind: SourceKind; prefix: string };

function ownerOf(specs: Specs, m: Draft, all: readonly Draft[]): Owner | null {
  if (m.target !== null && !isNewRef(m.target)) {
    const parsed = parseItemId(m.target);
    return parsed && { kind: parsed.kind, prefix: parsed.prefix };
  }
  if (m.target !== null) {
    const ref = m.target;
    const create = all.find((c) => c.ref === ref);
    return create && create.target === null ? ownerOf(specs, create, all) : null;
  }
  if (m.into !== undefined)
    return hasOp(specs, m.into, m.op) ? { kind: m.into, prefix: m.into } : null;
  const kind = Object.keys(specs).find((each) => hasOp(specs, each, m.op));
  return kind === undefined ? null : { kind, prefix: kind };
}

function specFor(specs: Specs, m: Draft, all: readonly Draft[]): (Owner & { spec: OpSpec }) | null {
  const owner = ownerOf(specs, m, all);
  if (owner === null || !hasOp(specs, owner.kind, m.op)) return null;
  const spec = catalogueFor(specs, owner.kind).ops[m.op];
  return spec ? { ...owner, spec } : null;
}

function mustSpec(specs: Specs, m: Draft, all: readonly Draft[]): Owner & { spec: OpSpec } {
  const found = specFor(specs, m, all);
  if (!found) throw new Error(`no catalogue has the op ${m.op} for ${m.target ?? "a new item"}`);
  return found;
}

// Returns the validated arguments: they are what gets stored and replayed.
function check(specs: Specs, drafts: readonly Draft[]): Checked[] {
  const named = new Map<NewRef, string>();
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
    const args = spec.args(m.args, "$.args");
    if (!args.ok) throw invalid(where, args.issues);
    // Apply sends the item a ref's create made, so a ref may stand only
    // where the op takes one, and name an item of the kind it takes there.
    const given = args.value as Record<string, unknown>;
    for (const ref of spec.refs(args.value).filter(isNewRef)) {
      const arg = Object.keys(spec.newRefArgs).find((name) => given[name] === ref);
      if (arg === undefined)
        throw new ChangeSetError("invalid", `${where}: ${m.op} can't name a new item there`);
      const maker = named.get(ref);
      if (maker === undefined)
        throw new ChangeSetError(
          "invalid",
          `${where}: ${ref} isn't created by an earlier mutation`,
        );
      if (maker !== spec.newRefArgs[arg])
        throw new ChangeSetError(
          "refused",
          `${where}: ${ref} is made by ${maker}, and its ${arg} takes one made by ${spec.newRefArgs[arg]}`,
        );
    }
    if (m.ref !== null) {
      if (named.has(m.ref))
        throw new ChangeSetError("invalid", `${where}: ${m.ref} is named twice`);
      named.set(m.ref, m.op);
    }
    return {
      op: m.op,
      target: m.target,
      ref: m.ref,
      ...(m.into === undefined ? {} : { into: m.into }),
      args: JSON.parse(JSON.stringify(args.value) ?? "null"),
      ...found,
    };
  });
}

function outsideRegion(
  checked: readonly { m: Checked; seq: number }[],
  member: (handle: string) => boolean,
  targets: boolean,
): string | null {
  for (const { m, seq } of checked) {
    const where = `mutation ${seq} (${m.op})`;
    if (targets && m.target !== null && !isNewRef(m.target) && !member(m.target))
      return `${where}: ${key(m.target)} isn't in this thread's region`;
    const stray = m.spec.refs(m.args).find((id) => !isNewRef(id) && !member(id));
    if (stray !== undefined) return `${where}: ${key(stray)} isn't in this thread's region`;
  }
  return null;
}

const couldNotCheck = (name: string) =>
  `Oriel couldn't check this with ${name} just now; ${name} checks it when it's applied.`;

function approvedFrom(preview: FieldValues | null): FieldValues | null {
  if (preview === null) return null;
  const values = Object.fromEntries(Object.entries(preview).filter(([f]) => !f.startsWith("$")));
  return Object.keys(values).length > 0 ? values : null;
}

// An `expected` of undefined means Oriel is missing a value it recorded at apply, so it can't revert that field safely.
export function explainConflicts(
  conflicts: readonly Conflict[],
  specs: Specs,
  title: (id: ItemId) => string | null = () => null,
): string {
  const parts = conflicts.map((c) => {
    const item = key(c.target);
    const catalogue = catalogueOf(specs, c.target);
    const own = catalogue.explain?.(c, title(c.target)) ?? null;
    if (own !== null) return own;
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

// Never from a source, so listing or searching every change set costs no source a request.
export async function changesOf(set: ChangeSet, specs: Specs, known: Known): Promise<ChangeRead[]> {
  const titles = new Map<string, string | null>();
  const lines: ChangeRead[] = [];
  for (const m of set.mutations) {
    const found = specFor(specs, m, set.mutations);
    if (!found || !found.spec.args(m.args).ok) {
      lines.push({
        source: found ? catalogueFor(specs, found.kind).name : "",
        sentence: `${staleArgs}.`,
        text: [],
      });
      continue;
    }
    const { kind, spec } = found;
    const catalogue = catalogueFor(specs, kind);
    const after = spec.after(m.args);
    const before = m.applied?.before ?? approvedFrom(m.preview) ?? {};
    const title = (id: ItemId | NewRef): string | null =>
      isNewRef(id) ? (titles.get(id) ?? null) : known.title(id);
    const subject: Subject =
      m.target === null
        ? null
        : isNewRef(m.target)
          ? { kind: "new", ref: m.target, title: title(m.target) }
          : {
              kind: "item",
              id: m.target,
              title: known.title(m.target) ?? text(before[catalogue.titleField]),
            };
    const sentence = await spec.describe(m.args, {
      subject,
      before,
      name: async (id) => known.name(id),
      title: async (id) => title(id),
    });
    if (m.ref !== null) titles.set(m.ref, text(after[catalogue.titleField]));
    // Text that only looks like an ID, such as "fix:login", is words.
    const written = Object.entries(after).flatMap(([field, value]) => {
      if (catalogue.fields[field] === "item") return [];
      const words =
        typeof value === "object" && value !== null && "title" in value ? value.title : value;
      const kind = typeof words === "string" ? parseItemId(words)?.kind : undefined;
      return typeof words === "string" &&
        words.trim() !== "" &&
        !(kind !== undefined && Object.hasOwn(specs, kind)) &&
        !isNewRef(words)
        ? [words]
        : [];
    });
    lines.push({ source: catalogue.name, sentence, text: written });
  }
  return lines;
}

export type Wiring = Pick<ChangeSetDeps, "writerConfig" | "names" | "readers">;

// `rewire` builds them again in place, so an apply running then keeps its writer and its place.
export function changeSets(deps: ChangeSetDeps): ChangeSets & { rewire(next: Wiring): void } {
  const sources: Sources = {};
  const rewire = (next: Wiring) => {
    const writers = buildWriters(next.writerConfig, deps.log);
    const unknown = async () => null;
    const prefixes = new Set([...Object.keys(writers), ...Object.keys(next.readers ?? {})]);
    const built = Object.fromEntries(
      [...prefixes].flatMap(
        (prefix): [string, { writer: SourceWriter | null; reader: unknown }][] => {
          const writer = writers[prefix];
          const name = writer?.name?.bind(writer) ?? next.names?.[prefix] ?? unknown;
          if (writer) return [[prefix, { writer, reader: { current: writer.current, name } }]];
          const reader = next.readers?.[prefix];
          return reader ? [[prefix, { writer: null, reader }]] : [];
        },
      ),
    ) as Sources;
    for (const prefix of Object.keys(sources)) delete sources[prefix];
    Object.assign(sources, built);
  };
  rewire(deps);
  return { ...changeSetsOver({ ...deps, sources }), rewire };
}

// The package entry doesn't export it, so production code can't pass a writer in.
export function changeSetsOver(deps: EngineDeps): ChangeSets {
  const { db, specs } = deps;
  const rows = store(db);
  // Until an apply returns, every action on its change set is refused as busy, so no mutation is sent twice at once
  // and no edit races the one in flight.
  const applying = new Map<string, { ms: number }>();

  const at = (): { now: Instant; ms: number } => {
    const now = deps.now();
    return { now, ms: Date.parse(now) };
  };

  const mustLoad = (id: string): ChangeSet => {
    const set = rows.load(id);
    if (!set) throw new ChangeSetError("not-found", `no change set ${id}`);
    return set;
  };

  // The latest decision, an approval, whose hash matches the hash derived from the rows as they are now.
  const approvalOf = (set: ChangeSet): void => {
    if (set.decision?.kind === "approved") return;
    throw new ChangeSetError(
      "not-approved",
      "this change set isn't approved as it stands; review the diff and approve it",
    );
  };

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

  const sourceOf = (prefix: string): { writer: SourceWriter | null; reader: FieldReader } => {
    const found = deps.sources[prefix];
    if (!found) throw new Error(`${prefix} items are read-only`);
    return found;
  };
  const reader = (prefix: string): FieldReader => sourceOf(prefix).reader;
  const unwritable = (set: ChangeSet): string | null => {
    const names = new Set<string>();
    for (const m of set.mutations) {
      if (m.status === "applied") continue;
      const { kind, prefix } = mustSpec(specs, m, set.mutations);
      if (deps.sources[prefix]?.writer) continue;
      names.add(catalogueFor(specs, kind).name);
    }
    if (names.size === 0) return null;
    return `Writing to ${[...names].join(" and ")} isn't configured here, so this change set can be reviewed but not approved or applied.`;
  };
  const writerOf = (prefix: string): SourceWriter => {
    const { writer } = sourceOf(prefix);
    if (!writer)
      throw new ChangeSetError(
        "read-only",
        `Writing to ${catalogueFor(specs, kindOf(prefix)).name} isn't configured here.`,
      );
    return writer;
  };

  // So `set.hash` is the hash of exactly what is rendered.
  // With `stored`, from what Oriel holds alone, asking no source: each line still to read says it's being checked.
  const render = async (
    set: ChangeSet,
    stored?: Known,
  ): Promise<{ diff: Diff; gone: Set<Ulid> }> => {
    const creates = new Map<string, MutationRecord>();
    for (const m of set.mutations) if (m.ref !== null) creates.set(m.ref, m);
    const itemOf = (m: MutationRecord): ItemId | null => {
      if (m.applied) return m.applied.item.id;
      if (m.target === null) return null;
      if (!isNewRef(m.target)) return m.target;
      return creates.get(m.target)?.applied?.item.id ?? null;
    };

    const shows = (spec: OpSpec, kind: SourceKind, args: unknown): FieldValues =>
      spec.deletes
        ? Object.fromEntries(Object.keys(catalogueFor(specs, kind).fields).map((f) => [f, null]))
        : spec.after(args);
    const titles = new Map<string, string | null>();
    for (const m of set.mutations) {
      const { kind, spec } = mustSpec(specs, m, set.mutations);
      if (m.status === "applied" || !spec.args(m.args).ok) continue;
      const after = spec.after(m.args);
      const field = catalogueFor(specs, kind).titleField;
      const carry = itemOf(m) ?? m.target ?? m.ref;
      if (carry !== null && Object.hasOwn(after, field)) titles.set(carry, text(after[field]));
    }

    type Wanted = { prefix: string; fields: Set<string>; stableId: string | null };
    const wanted = new Map<ItemId, Wanted>();
    for (const m of set.mutations) {
      const item = itemOf(m);
      if (item === null) continue;
      const { kind, prefix, spec } = mustSpec(specs, m, set.mutations);
      const entry = wanted.get(item) ?? {
        prefix,
        fields: new Set([catalogueFor(specs, kind).titleField]),
        stableId: null,
      };
      entry.stableId ??= m.applied?.item.stableId ?? stableIdFor(m, set, item);
      if (m.status !== "applied" && spec.args(m.args).ok)
        for (const field of Object.keys(shows(spec, kind, m.args))) entry.fields.add(field);
      wanted.set(item, entry);
    }
    // Read through the writer, so an item whose handle names another item now shows as gone: it isn't the item to change.
    // So does one whose handle names no member of the run's region now, as after a reused key.
    // A change to an item that can't be read can't be approved until it's read again.
    const live = new Map<ItemId, FieldValues | "gone" | "unread" | "checking">();
    const readLive = async (batch: [ItemId, Wanted][]) => {
      const [first] = batch;
      if (!first) return;
      const [, { prefix, fields }] = first;
      const { writer } = sourceOf(prefix);
      if (!writer) {
        for (const [item] of batch)
          live.set(
            item,
            await reader(prefix)
              .current(item, [...fields])
              .catch(() => "unread" as const),
          );
        return;
      }
      const asked = batch.flatMap(([item, { stableId }]) => (stableId === null ? [] : [item]));
      const found = asked.length ? await writer.read(asked, [...fields]).catch(() => null) : null;
      for (const [item, { stableId }] of batch) {
        const each = found?.get(item);
        live.set(
          item,
          stableId === null
            ? "gone"
            : each === undefined || (typeof each === "object" && "failed" in each)
              ? "unread"
              : each === "gone" || each.stableId !== stableId
                ? "gone"
                : each.values,
        );
      }
    };
    const batches = Map.groupBy([...wanted], ([, { prefix, fields }]) =>
      JSON.stringify([prefix, [...fields].toSorted()]),
    );
    await Promise.all(
      [...batches.values()].map((batch) =>
        stored
          ? batch.forEach(([item]) => live.set(item, "checking"))
          : readLive(batch).catch(() => {
              for (const [item] of batch) if (!live.has(item)) live.set(item, "unread");
            }),
      ),
    );
    const undecided = set.decision === null;
    const checked = new Map<Ulid, { refused: string } | { later: string }>();
    const asks = new Map<
      string,
      {
        writer: SourceWriter;
        op: string;
        name: string;
        rows: { m: MutationRecord; item: ItemId; stableId: string }[];
      }
    >();
    for (const m of stored || !undecided ? [] : set.mutations) {
      const item = itemOf(m);
      if (m.status !== "pending" || item === null || isNewRef(item)) continue;
      const { kind, prefix, spec } = mustSpec(specs, m, set.mutations);
      const { writer } = sourceOf(prefix);
      if (!writer?.check || !writer.checks?.includes(m.op) || !spec.args(m.args).ok) continue;
      const name = catalogueFor(specs, kind).name;
      const stableId = wanted.get(item)?.stableId ?? null;
      const now = live.get(item);
      if (stableId === null || now === undefined || now === "gone") continue;
      // After an earlier change of the same kind to the item, its state
      // then isn't its state now.
      const earlier = set.mutations.some(
        (e) => e.seq < m.seq && e.status === "pending" && e.op === m.op && itemOf(e) === item,
      );
      if (earlier) {
        checked.set(m.id, {
          later: `${name} checks this when it's applied, after the change above.`,
        });
        continue;
      }
      if (now === "unread") {
        checked.set(m.id, { later: couldNotCheck(name) });
        continue;
      }
      const ask = asks.get(`${prefix}\u0000${m.op}`) ?? { writer, op: m.op, name, rows: [] };
      ask.rows.push({ m, item, stableId });
      asks.set(`${prefix}\u0000${m.op}`, ask);
    }
    await Promise.all(
      [...asks.values()].map(async ({ writer, op, name, rows }) => {
        const answers = await writer
          .check?.(
            op,
            rows.map(({ m, item, stableId }) => ({
              target: item,
              expectedStableId: stableId,
              args: m.args,
            })),
          )
          .catch(() => null);
        for (const { m, item } of rows) {
          const answer = answers?.get(item);
          if (answer === undefined) checked.set(m.id, { later: couldNotCheck(name) });
          else if (answer.alike)
            checked.set(m.id, {
              later: `Oriel checked the same move above; ${name} checks this one when it's applied.`,
            });
          else if ("refused" in answer) checked.set(m.id, { refused: answer.refused });
        }
      }),
    );
    const state = new Map<string, Record<string, unknown>>();
    const title = async (id: ItemId | NewRef): Promise<string | null> => {
      if (isNewRef(id)) {
        const create = set.mutations.find((m) => m.ref === id);
        if (create?.applied) return title(create.applied.item.id);
        return titles.get(id) ?? null;
      }
      if (titles.has(id)) return titles.get(id) ?? null;
      if (stored) return stored.title(id);
      const parsed = parseItemId(id);
      if (!parsed) return null;
      const field = catalogueFor(specs, parsed.kind).titleField;
      const known = live.get(id);
      const values =
        known === undefined || known === "unread" || known === "checking"
          ? await reader(parsed.prefix)
              .current(id, [field])
              .catch(() => "gone" as const)
          : known;
      return values === "gone" ? null : text(values[field]);
    };
    const lines: Diff["lines"] = [];
    const gone = new Set<Ulid>();
    for (const m of set.mutations) {
      const { kind, prefix, spec } = mustSpec(specs, m, set.mutations);
      const catalogue = catalogueFor(specs, kind);
      const context = (subject: Subject, before: FieldValues) => ({
        subject,
        before,
        name: async (id: string) => (stored ? stored.name(id) : reader(prefix).name(id)),
        title,
      });
      const item = itemOf(m);
      const lineKind = spec.creates ? "create" : spec.deletes ? "delete" : "change";
      const titled = async (field: string, before: unknown, after: unknown) => {
        if (catalogue.fields[field] !== "item") return {};
        const named = async (value: unknown) =>
          typeof value === "string" && (isNewRef(value) || isItemId(value)) ? title(value) : null;
        return { titles: { before: await named(before), after: await named(after) } };
      };

      if (!spec.args(m.args).ok) {
        if (!m.applied) gone.add(m.id);
        lines.push({
          mutationId: m.id,
          sentence: `${staleArgs}, so it can't be shown, applied or reverted.`,
          target: m.target,
          kind: lineKind,
          makes: spec.makes,
          source: catalogue.name,
          fields: [],
        });
        continue;
      }

      if (m.applied && item !== null) {
        const { before, after } = m.applied;
        const now = live.get(item);
        const later =
          !Object.hasOwn(spec.after(m.args), catalogue.titleField) && titles.has(item)
            ? (titles.get(item) ?? null)
            : null;
        const name =
          later ??
          (now && typeof now === "object" ? text(now[catalogue.titleField]) : null) ??
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
          kind: lineKind,
          makes: spec.makes,
          source: catalogue.name,
          fields: await Promise.all(
            fields.map(async (f) => ({
              name: f,
              before: before[f] ?? null,
              after: after[f] ?? null,
              ...(await titled(f, before[f], after[f])),
            })),
          ),
        });
        continue;
      }

      const after = shows(spec, kind, m.args);
      const renames = Object.hasOwn(after, catalogue.titleField);
      let subject: Subject = null;
      let values: Record<string, unknown> = {};
      let checking = false;
      if (item !== null) {
        const read = live.get(item);
        // Once decided, a line Oriel can't read shows what it was approved
        // from; before, it can't be approved until it's read.
        const kept = undecided ? null : approvedFrom(m.preview);
        const now = (read === "unread" || read === "checking") && kept ? kept : read;
        if (now === "unread") {
          gone.add(m.id);
          lines.push({
            mutationId: m.id,
            sentence: `Oriel couldn't read ${key(item)} from ${catalogue.name} just now, so this change can't be shown or approved yet.`,
            target: m.target,
            kind: lineKind,
            makes: spec.makes,
            source: catalogue.name,
            fields: [],
          });
          continue;
        }
        if (now === undefined || now === "gone") {
          gone.add(m.id);
          lines.push({
            mutationId: m.id,
            sentence: `${key(item)} is no longer in ${catalogue.name}, so this change can't be made.`,
            target: m.target,
            kind: lineKind,
            makes: spec.makes,
            source: catalogue.name,
            fields: [],
          });
          continue;
        }
        if (now === "checking") checking = true;
        values =
          state.get(item) ?? (now === "checking" ? { ...approvedFrom(m.preview) } : { ...now });
        const name = renames ? text(values[catalogue.titleField]) : await title(item);
        subject = { kind: "item", id: item, title: name };
      } else if (m.target !== null && isNewRef(m.target)) {
        values = state.get(m.target) ?? {};
        const name = renames ? text(values[catalogue.titleField]) : await title(m.target);
        subject = { kind: "new", ref: m.target, title: name };
      }
      // A row sent with no answer may have landed, so the source may hold
      // its value already: it shows what the person approved it from.
      const shown = m.status === "failed" ? approvedFrom(m.preview) : null;
      const before = Object.fromEntries(
        Object.keys(after).map((f) => [f, (shown ? shown[f] : values[f]) ?? null]),
      );
      const check = checked.get(m.id);
      lines.push({
        mutationId: m.id,
        sentence: await spec.describe(m.args, context(subject, before)),
        target: m.target,
        kind: lineKind,
        makes: spec.makes,
        source: catalogue.name,
        ...(check ? { check } : {}),
        ...(checking ? { checking: true as const } : {}),
        fields: await Promise.all(
          Object.keys(after).map(async (f) => {
            const value = after[f];
            const created =
              Object.hasOwn(spec.newRefArgs, f) && typeof value === "string" && isNewRef(value);
            return {
              name: f,
              before: before[f],
              after: value,
              ...(created ? { createdAbove: true as const } : {}),
              ...(await titled(f, before[f], value)),
            };
          }),
        ),
      });
      const carry = item ?? m.target ?? m.ref;
      if (carry !== null) state.set(carry, { ...values, ...after });
    }
    return {
      diff: {
        changeSetId: set.id,
        hash: set.hash,
        ...(stored ? { stored: true as const } : {}),
        lines,
      },
      gone,
    };
  };

  // Approval requires a diff since the last edit with none of its lines gone. Not while approved, nor if the rows changed
  // while rendering; a sent row keeps the values it was approved from, since what landed may show now.
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
        const refused = line.check && "refused" in line.check ? line.check.refused : null;
        rows.setPreview(line.mutationId, {
          ...values,
          ...(gone ? { [goneMark]: true } : {}),
          ...(refused === null ? {} : { [refusedMark]: refused }),
        });
      }
    });

  const diff = async (set: ChangeSet): Promise<Diff> => {
    const rendered = await render(set);
    keepPreview(set, rendered);
    return rendered.diff;
  };

  // The update time is skipped: any write moves it. A field whose `before` or `after` is missing is a conflict: Oriel
  // can't tell whether anyone changed it, or can't put it back. Once unknown, a later mutation doesn't hide that.
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
      const prefix = parseItemId(item)?.prefix;
      if (!prefix || fields.size === 0) continue;
      const current = await writerOf(prefix).current(item, [...fields.keys()]);
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

  // An item a change set created may be deleted only if nobody touched it since: its update time must be the one recorded.
  const touched = async (
    item: ItemId,
    onItem: readonly MutationRecord[],
  ): Promise<Conflict | null> => {
    const last = onItem.at(-1);
    if (!last?.applied) throw new Error(`no applied mutation on ${item}`);
    const parsed = parseItemId(item);
    if (!parsed) throw new Error(`not an item ID: ${item}`);
    const field = catalogueFor(specs, parsed.kind).updatedField;
    const expected = last.applied.after[field];
    const current = await writerOf(parsed.prefix).current(item, [field]);
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

  // The source may have changed since the revert was built.
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

  const resolveArgs = (
    m: MutationRecord,
    set: ChangeSet,
  ): { args: Record<string, unknown> } | { failed: string } => {
    const args: Record<string, unknown> = { ...(m.args as Record<string, unknown>) };
    for (const name of Object.keys(mustSpec(specs, m, set.mutations).spec.newRefArgs)) {
      const value = args[name];
      if (typeof value !== "string" || !isNewRef(value)) continue;
      const create = set.mutations.find((c) => c.ref === value && c.seq < m.seq);
      if (!create?.applied) return { failed: `it names ${value}, which hasn't been created` };
      args[name] = create.applied.item.id;
    }
    return { args };
  };

  // Throws once an edit or a later decision voids the approval.
  const approved = (id: string, mutationId: Ulid) => {
    const set = mustLoad(id);
    approvalOf(set);
    return { set, m: set.mutations.find((r) => r.id === mutationId) ?? null };
  };

  // Null when the handle names no member of that region any more, such as a key another item has taken since.
  const stableIdFor = (m: MutationRecord, set: ChangeSet, target: ItemId): string | null => {
    if (m.target !== null && isNewRef(m.target)) {
      const ref = m.target;
      return set.mutations.find((c) => c.ref === ref)?.applied?.item.stableId ?? null;
    }
    if (m.reverts) return rows.mutation(m.reverts)?.applied?.item.stableId ?? null;
    const region = rows.region(set.runId, set.workspaceId);
    return region.has(target) ? region.stableId(target) : null;
  };

  // A revert may target anything the change set it reverts touched, and an item this change set created is its own,
  // so neither is checked.
  const leftWorkstream = (
    m: MutationRecord,
    set: ChangeSet,
    target: ItemId | null,
  ): string | null => {
    if (target === null || m.reverts !== null || (m.target !== null && isNewRef(m.target)))
      return null;
    const source = parseItemId(target)?.prefix;
    const stableId = stableIdFor(m, set, target);
    if (!source || stableId === null || rows.inWorkstreamNow(set.threadId, source, stableId))
      return null;
    return `${key(target)} was removed from the workstream after this was captured, so it wasn't sent.`;
  };

  // As when an earlier send landed but its answer was lost. Oriel can't know whether the value is its own write
  // or someone else's, so the result's `before` leaves the field out and a revert can't put it back.
  const inPlace = async (
    m: MutationRecord,
    set: ChangeSet,
    { kind, prefix }: Owner,
    spec: OpSpec,
    target: ItemId,
  ): Promise<{ applied: AppliedValue } | "absent" | { unknown: string }> => {
    const after = spec.after(m.args);
    const fields = Object.keys(after);
    const updated = catalogueFor(specs, kind).updatedField;
    const stableId = stableIdFor(m, set, target);
    if (stableId === null)
      return { unknown: `${key(target)} no longer names an item in the region it was made in` };
    // A read that fails tells nothing either. A bug in Oriel (a RangeError, say) isn't the source's answer, and throws.
    const found = await writerOf(prefix)
      .read([target], [...fields, updated])
      .then((read) => read.get(target) ?? { failed: new Error("no answer") })
      .catch((failed: unknown) => ({ failed }));
    if (found === "gone") return { unknown: `${key(target)} can't be read` };
    if ("failed" in found) {
      if (found.failed instanceof RangeError || found.failed instanceof SyntaxError)
        throw found.failed;
      return { unknown: `reading ${key(target)} failed: ${message(found.failed)}` };
    }
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

  const complete = (id: string): void => {
    const { now } = at();
    if (!rows.markCompleted(id as Ulid, now)) return;
    const set = mustLoad(id);
    const wrote = new Set(
      set.mutations.flatMap((m) => (m.applied ? [mustSpec(specs, m, set.mutations).kind] : [])),
    );
    deps.emit({
      name: "changeset.applied",
      at: now,
      workspaceId: set.workspaceId,
      changeSetId: set.id,
      threadId: set.threadId,
      sources: Object.keys(specs).filter((kind) => wrote.has(kind)),
    });
  };

  const hasWriter = (prefix: string) => Boolean(deps.sources[prefix]?.writer);

  // `nextSteps` offers exactly the actions whose guard passes, so nothing it offers is refused and nothing refused is offered.
  type Refusal = {
    code: ChangeSetErrorCode;
    message: string;
    stop?: Ulid;
    unsent?: true;
    unsendable?: true;
  };
  const refuse = (refusal: Refusal): never => {
    throw new ChangeSetError(refusal.code, refusal.message);
  };

  // No edit can race the row in flight, and the apply records completion.
  const busy = (set: ChangeSet): Refusal | null =>
    applying.has(set.id)
      ? { code: "busy", message: "this change set is being applied; try again once that ends" }
      : null;

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

  // A create or a link may have landed and is never sent twice; a set op's send may still be on its way until its lease ends.
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

  // A set op sent before may have landed: apply first checks whether it is in place and records it if so, whatever the
  // workstream or region holds now. It is unsent again only if found absent.
  const sendPlan = (
    m: MutationRecord,
    set: ChangeSet,
    checked: "no" | "absent" | "unknown" = "no",
  ): { refusal: Refusal } | { target: ItemId | null; stableId: string | null; args: unknown } => {
    const { kind, prefix, spec } = mustSpec(specs, m, set.mutations);
    if (!hasWriter(prefix))
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
    const args = resolveArgs(m, set);
    if ("failed" in args) return stop(args.failed);
    // The writer refuses a target whose handle names another item by now.
    const stableId = where.target === null ? null : stableIdFor(m, set, where.target);
    if (sentBefore && spec.idempotent && where.target !== null && checked === "no")
      return { target: where.target, stableId, args: args.args };
    if (where.target !== null && stableId === null)
      return stop(
        `${key(where.target)} no longer names an item in the region this change was made in, so it wasn't sent.`,
      );
    const away = leftWorkstream(m, set, where.target);
    if (away) return stop(away);
    return { target: where.target, stableId, args: args.args };
  };

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
    // Sending it again as approved would only be refused again.
    if (refusedForGood(first))
      return {
        code: "refused",
        message: `${catalogueFor(specs, mustSpec(specs, first, set.mutations).kind).name} won't take mutation ${first.seq} as it stands; leave it out and approve the rest, or dismiss the rest`,
      };
    const plan = sendPlan(first, set);
    return "refusal" in plan ? plan.refusal : null;
  };

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
    const unwanted = open.find(
      (m) => typeof m.preview?.[refusedMark] === "string" || refusedForGood(m),
    );
    if (unwanted)
      return refused(
        `mutation ${unwanted.seq} (${unwanted.op}): ${catalogueFor(specs, mustSpec(specs, unwanted, set.mutations).kind).name} won't take it as it stands; leave it out, or reject the change set`,
      );
    return sentAndWaiting(first, set);
  };

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

  // Leaving rows out of a change set that is approved and hasn't stopped waits until it has.
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
      // A revert puts back what was there; changing one of its rows would write something else under that name.
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
    // Targets don't change in an edit, and a revert's may be items it created, so only the edited arguments are held to the region.
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

  // Nothing sent and unanswered unless the rest was dismissed, so the revert covers exactly what applied; and no revert
  // of it already: the items no longer hold what this applied, so a second could only conflict.
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
    const created = new Map<ItemId, MutationRecord>();
    for (const m of applied) {
      const { kind, prefix, spec } = mustSpec(specs, m, set.mutations);
      if (!hasWriter(prefix))
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
      const { prefix, spec } = mustSpec(specs, m, set.mutations);
      const step = spec.undo(m.args, m.applied);
      if ("refused" in step)
        return refused(`mutation ${m.seq} (${m.op}) can't be reverted: ${step.refused}`);
      // What its writer says up front it can't send is never offered, rather than stalling once sent.
      const cannot = deps.sources[prefix]?.writer?.unsendable?.[step.op];
      if (cannot !== undefined) return { ...refused(cannot), unsendable: true };
      // What it would put back must pass the catalogue as it is now.
      const kind = parseItemId(m.applied.item.id)?.kind;
      const back =
        kind && hasOp(specs, kind, step.op) ? catalogueFor(specs, kind).ops[step.op] : undefined;
      if (!back?.args(step.args).ok)
        return refused(
          `mutation ${m.seq} (${m.op}) can't be reverted: what it would put back is no longer a valid change`,
        );
    }
    return null;
  };

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

  // Stops at the first failure, so a retry can't land a later mutation first. Each write is marked sent before it goes out and
  // compares the row's version it read: a crash leaves that on record, and of two instances on one row version only one sends.
  const applyOnce = async (id: string, run: { ms: number }): Promise<ApplyReport> => {
    const first = mustLoad(id);
    const report: ApplyReport = { changeSetId: first.id, applied: [], skipped: [], failed: [] };
    // A row found absent goes back to unsent only if nothing wrote to it since the read that found it so.
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
      const seen = { version: m.version };
      const wasSent = m.status === "failed";
      const owner = mustSpec(specs, m, set.mutations);
      const { spec } = owner;
      const source = catalogueFor(specs, owner.kind).name;
      let plan = sendPlan(m, set);
      if ("refusal" in plan) return stopAt(mutationId, plan.refusal, seen);
      const writes = Object.keys(spec.after(m.args));
      // Found absent, an earlier send is known not to have landed; if Oriel couldn't tell, it may have, so it isn't sent again.
      let inPlaceFound: "no" | "absent" | "unknown" = "no";
      if (spec.idempotent && plan.target !== null) {
        const result = await inPlace(m, set, owner, spec, plan.target);
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
        args: plan.args,
        // For a writer that checks the source still holds what the diff showed before it writes.
        seen: approvedFrom(m.preview) ?? {},
      });
      const uncertain = mayHaveLanded(source);
      const notice = spec.idempotent
        ? `Sent to ${source}, with no answer recorded yet. Try again: Oriel checks whether it landed before sending it again.`
        : uncertain;
      const sending = at();
      const mark = `${notice} (sent ${sending.now})`;
      run.ms = sending.ms;
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
      const sent = { version: sentVersion };
      const unanswered = (error: string): ApplyReport => {
        rows.markFailed(mutationId, sent, error);
        report.failed.push({ mutationId, error });
        return report;
      };
      const unsure = spec.idempotent ? "" : ` ${uncertain}`;
      let result: unknown;
      try {
        const until = sending.ms + writeLimitMs;
        result = await writerOf(owner.prefix).apply(request, { left: () => until - at().ms });
      } catch (error) {
        const said = `${message(error).replace(/\.$/, "")}.`;
        // Nothing landed. The row is unsent again, unless an earlier send of it went unchecked and may still be there.
        if (error instanceof SourceRefused) {
          const why = `${error.final ? finalMark : ""}${error.sent ? said : `${notSent}${said}`}`;
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
      run.ms = at().ms;
      const checked = writeResult(result);
      if (!checked.ok) {
        return unanswered(
          `The source answered in a shape Oriel can't read: ${JSON.stringify(checked.issues)}.${unsure}`,
        );
      }
      // A row already sent when the pass began keeps no `before` for the fields it writes: an earlier send may have
      // landed, so the source's "before" may be Oriel's own value, which a revert must report rather than restore.
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

  // Checked: minted for this change set, with a typed name.
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

  const ranIn = (run: unknown): RunRef => {
    const owner = runRef(run, "$.run");
    if (!owner.ok) throw invalid("run", owner.issues);
    if (!rows.runExists(owner.value))
      throw new ChangeSetError("not-found", `no run ${owner.value.id} in that thread`);
    return owner.value;
  };

  // Every path that takes a capture in checks it here: a capture, a second look's suggestion, the agent's revision.
  const captured = (
    mutations: unknown,
    before: readonly Draft[],
    runId: Ulid | null,
    workspaceId: Ulid,
  ): { m: Checked; seq: number }[] => {
    const parsed = array(capturedMutation)(mutations, "$.mutations");
    if (!parsed.ok) throw invalid("mutations", parsed.issues);
    if (parsed.value.length === 0)
      throw new ChangeSetError("invalid", "a change set needs at least one mutation");
    const added = check(specs, [...before, ...parsed.value])
      .slice(before.length)
      .map((m, i) => ({ m, seq: before.length + i + 1 }));
    const revertOnly = added.find(({ m }) => m.spec.revertOnly);
    if (revertOnly)
      throw new ChangeSetError(
        "invalid",
        `mutation ${revertOnly.seq} (${revertOnly.m.op}): exists only to revert a change, so a run can't ask for it`,
      );
    const region = rows.region(runId, workspaceId);
    const outside = outsideRegion(added, (handle) => region.has(handle), true);
    if (outside) throw new ChangeSetError("refused", outside);
    return added;
  };

  // The caller holds the transaction and has checked both.
  const rewrite = (
    current: ChangeSet,
    drop: readonly MutationRecord[],
    add: readonly { m: Checked }[],
  ): void => {
    for (const m of drop) rows.remove(current.id, m.id);
    const gone = new Set(drop.map((m) => m.id));
    const last = Math.max(0, ...current.mutations.filter((m) => !gone.has(m.id)).map((m) => m.seq));
    add.forEach(({ m }, i) =>
      rows.insertMutation(current.workspaceId, current.id, {
        id: ulid(at().ms),
        seq: last + i + 1,
        op: m.op,
        target: m.target,
        ref: m.ref,
        ...(m.into === undefined ? {} : { into: m.into }),
        args: m.args,
        reverts: null,
      }),
    );
    rows.clearPreviews(current.id);
  };

  const unrevisable = (set: ChangeSet | null, threadId: Ulid): string | null => {
    if (
      !set ||
      set.threadId !== threadId ||
      set.runId === null ||
      set.revertOf !== null ||
      rows.runModel(set.runId) === orielRunModel
    )
      return "only a change set you proposed in this thread can be revised";
    // A decision an edit voided would stand again if a revision put back
    // the rows it was made on: only a set nobody ever decided on is revised.
    if (set.decision !== null || rows.everDecided(set.id))
      return `change set ${set.id} was decided on already, so only the user can change it`;
    if (set.mutations.some((m) => m.status !== "pending"))
      return `change set ${set.id} has started applying, so it can't change any more`;
    return null;
  };

  // The caller holds the transaction.
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
        ...(m.into === undefined ? {} : { into: m.into }),
        args: m.args,
        reverts: m.reverts,
      }),
    );
  };

  return {
    async capture(run, mutations) {
      const owner = ranIn(run);
      const checked = captured(mutations, [], owner.id, owner.workspaceId);
      const id = ulid(at().ms);
      transaction(db, () =>
        insertAll(
          {
            id,
            workspaceId: owner.workspaceId,
            threadId: owner.threadId,
            runId: owner.id,
            revertOf: null,
          },
          checked.map(({ m }) => ({ ...m, reverts: null })),
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

    async stored(id, known) {
      return (await render(mustLoad(id), known)).diff;
    },

    async look(id) {
      return (await render(mustLoad(id))).diff;
    },

    async extend(id, additions, max) {
      const parsed = array(capturedMutation)(additions, "$.mutations");
      if (!parsed.ok) throw invalid("mutations", parsed.issues);
      if (parsed.value.length === 0) throw new ChangeSetError("invalid", "there's nothing to add");
      // A suggestion's refs were numbered in another run: only a change to
      // an item that exists can join.
      if (parsed.value.some((m) => m.ref !== null || (m.target !== null && isNewRef(m.target))))
        throw new ChangeSetError("refused", "only a change to an item that exists can be added");
      const set = transaction(db, () => {
        const current = mustLoad(id);
        const pre = busy(current) ?? decided(current);
        if (pre) refuse(pre);
        if (current.decision !== null || current.revertOf !== null)
          throw new ChangeSetError("refused", "only a change set nobody has decided on takes more");
        if (current.mutations.some((m) => m.status !== "pending"))
          throw new ChangeSetError("refused", "this change set has started applying");
        if (current.mutations.length + parsed.value.length > max)
          throw new ChangeSetError("refused", `a change set holds at most ${max} changes`);
        const added = captured(parsed.value, current.mutations, current.runId, current.workspaceId);
        rewrite(current, [], added);
        return current;
      });
      deps.emit({
        name: "changeset.edited",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
      });
      return mustLoad(id);
    },

    async revisable(id, threadId) {
      const set = rows.load(id);
      return set ? (busy(set)?.message ?? unrevisable(set, threadId)) : unrevisable(null, threadId);
    },

    async revise(id, run, mutations) {
      const owner = ranIn(run);
      const set = transaction(db, () => {
        const current = mustLoad(id);
        const pre = busy(current);
        if (pre) refuse(pre);
        const why = unrevisable(current, owner.threadId);
        if (why !== null) throw new ChangeSetError("refused", why);
        const checked = captured(mutations, [], owner.id, owner.workspaceId);
        rewrite(current, current.mutations, checked);
        rows.markRevised(current.id, owner.id, at().now);
        return mustLoad(current.id);
      });
      deps.emit({
        name: "changeset.revised",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
        threadId: set.threadId,
        mutations: set.mutations.length,
      });
      return set;
    },

    changes: (set, known) => changesOf(set, specs, known),

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
        // An edit that changes nothing leaves the approval and the diff standing; otherwise the new hash voids the approval.
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

    async undoRejection(id) {
      const set = transaction(db, () => {
        const current = mustLoad(id);
        const { decision } = current;
        const why =
          decision?.kind !== "rejected"
            ? "this change set isn't rejected"
            : decision.via !== "thread"
              ? `${decision.by} rejected it on its review link, so only they decided it: ask the agent for it again`
              : current.revertOf !== null
                ? "a revert's rejection can't be undone: press Revert again instead"
                : current.mutations.some((m) => m.status !== "pending")
                  ? "part of it was sent before it was dismissed, so it can't be put back"
                  : rows.undoDecision(decision.id, at().now)
                    ? null
                    : "this rejection was undone already";
        if (why !== null) refuse({ code: "refused", message: why });
        return current;
      });
      deps.emit({
        name: "changeset.unrejected",
        at: deps.now(),
        workspaceId: set.workspaceId,
        changeSetId: set.id,
      });
      return mustLoad(id);
    },

    async apply(id) {
      const set = mustLoad(id);
      const refusal = applyRefusal(set);
      if (refusal) {
        const row = set.mutations.find((m) => m.id === refusal.stop);
        if (row) rows.markStopped(row.id, row, refusal.message);
        refuse(refusal);
      }
      const run = { ms: at().ms };
      applying.set(id, run);
      try {
        return await applyOnce(id, run);
      } finally {
        applying.delete(id);
      }
    },

    applying(id) {
      return applying.has(id);
    },

    stalled(id) {
      const run = applying.get(id);
      return run !== undefined && at().ms >= run.ms + sendLeaseMs;
    },

    writable(id) {
      return unwritable(mustLoad(id)) === null;
    },

    cannotUndo(id) {
      const set = mustLoad(id);
      const refusal = revertRefusal(set, revertsOf(set));
      return refusal?.unsendable ? refusal.message : null;
    },

    // A partly applied change set that wasn't dismissed loses its unsent rows in the same transaction, so nothing more
    // of it can land. A dismissed one keeps its rows, and with them what its dismissal said may have landed.
    async revert(id) {
      const set = mustLoad(id);
      const refusal = revertRefusal(set, revertsOf(set));
      if (refusal) refuse(refusal);
      const applied = set.mutations.filter((m) => m.applied !== null);

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

    // The link the token is, not one minted since for its change set.
    async reviewLinkOpened(token) {
      const link = liveLink(token);
      if (link) rows.markLinkOpened(link.token_hash, at().now);
    },

    async unopenedLinks(workspaceId) {
      return rows.unopenedLinks(
        workspaceId,
        new Date(at().ms - linkLifetimeMs).toISOString() as Instant,
      );
    },

    async revokeReviewLink(id) {
      const set = mustLoad(id);
      rows.revokeLinks(set.id, at().now);
    },

    async revokeAllReviewLinks(workspaceId) {
      return rows.revokeAllLinks(workspaceId, at().now);
    },

    // Called only on an explicit POST, never on the GET a link unfurler makes: it reads the source and records previews.
    async openReview(token) {
      const link = liveLink(token);
      if (!link) return null;
      const set = rows.load(link.change_set_id);
      if (!set) return null;
      return { changeSet: set, diff: await diff(set) };
    },

    async nextSteps(id) {
      const set = mustLoad(id);
      return stepsOf(set, revertsOf(set));
    },

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

const unheard =
  /^(?:fetch failed|The operation was aborted due to timeout|This operation was aborted)\.?(?: ([\s\S]*))?$/;

const notSent = "Nothing was sent: ";
const finalMark = "Refused as it stands: ";
const refusedForGood = (m: { status: string; error: string | null }): boolean =>
  m.status === "pending" && m.error?.startsWith(finalMark) === true;
const answer =
  /^(GET|PUT|POST|DELETE) \S+: (?:(\d{3})|unexpected response \([^)]*\))\.?(?: ([\s\S]*))?$/;

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

export function plainError(error: string): string {
  if (error.startsWith(finalMark)) return plainError(error.slice(finalMark.length));
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
