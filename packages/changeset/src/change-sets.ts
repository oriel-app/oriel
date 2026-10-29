import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
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
  type LinkRow,
  type NewMutation,
} from "./store.ts";

// The read side a diff needs: values as they are now in the source.
export type Reader<K extends SourceKind = SourceKind> = {
  // Field names as in the source's catalogue (see jira.ts); "gone" when the
  // item no longer exists.
  current(id: ItemId<K>, fields: readonly string[]): Promise<FieldValues | "gone">;
  // A person's display name for a diff line; null when unknown.
  person(accountId: string): Promise<string | null>;
};

export type ChangeSetDeps = {
  db: DatabaseSync;
  sources: { [K in SourceKind]: { writer: SourceWriter<K>; reader: Reader<K> } };
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

// Adding a source kind makes this require its catalogue.
const catalogues: Record<SourceKind, Catalogue> = { jira: jiraCatalogue };

const linkLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const maxErrorChars = 500;

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

// The one place an `Approved` value is made (decision 0003). Callers mint right
// before `writer.apply`, from rows whose hash the latest approval matches.
function mint<K extends SourceKind>(request: WriteRequest<K>): Approved<WriteRequest<K>> {
  return Object.freeze(request) as Approved<WriteRequest<K>>;
}

// The source a mutation writes to: its target's, or, for a create or a new
// item, the one source whose catalogue has the op.
function sourceOf(op: string, target: string | null): SourceKind | null {
  const parsed = target === null || isNewRef(target) ? null : parseItemId(target);
  if (parsed) return parsed.source;
  const owners = sourceKinds.filter((kind) => Object.hasOwn(catalogues[kind].ops, op));
  return owners.length === 1 ? (owners[0] ?? null) : null;
}

function specOf(op: string, target: string | null): { kind: SourceKind; spec: OpSpec } | null {
  const kind = sourceOf(op, target);
  if (kind === null || !Object.hasOwn(catalogues[kind].ops, op)) return null;
  const spec = catalogues[kind].ops[op];
  return spec ? { kind, spec } : null;
}

function mustSpec(m: { op: string; target: string | null }): { kind: SourceKind; spec: OpSpec } {
  const found = specOf(m.op, m.target);
  if (!found) throw new Error(`no catalogue has the op ${m.op} for ${m.target ?? "a new item"}`);
  return found;
}

// Validates each mutation's arguments and its refs, in seq order: only a create
// names a new item, each name once, and a target may name only an item that an
// earlier create in the same change set names. Returns the validated arguments,
// which are what gets stored and replayed.
function check(drafts: readonly Draft[]): Draft[] {
  const named = new Set<NewRef>();
  return drafts.map((m, i) => {
    const where = `mutation ${i + 1} (${m.op})`;
    const found = specOf(m.op, m.target);
    if (!found) throw new ChangeSetError("invalid", `${where}: not an operation Oriel can make`);
    const { spec } = found;
    if (spec.creates && m.target !== null)
      throw new ChangeSetError("invalid", `${where}: a create has no target`);
    if (!spec.creates && m.target === null)
      throw new ChangeSetError("invalid", `${where}: needs an item to change`);
    if (!spec.creates && m.ref !== null)
      throw new ChangeSetError("invalid", `${where}: only a create can name a new item`);
    if (m.target !== null && isNewRef(m.target) && !named.has(m.target))
      throw new ChangeSetError(
        "invalid",
        `${where}: ${m.target} isn't created by an earlier mutation`,
      );
    if (m.ref !== null) {
      if (named.has(m.ref))
        throw new ChangeSetError("invalid", `${where}: ${m.ref} is named twice`);
      named.add(m.ref);
    }
    const args = spec.args(m.args, "$.args");
    if (!args.ok) throw invalid(where, args.issues);
    return { ...m, args: JSON.parse(JSON.stringify(args.value) ?? "null") };
  });
}

function conflictText(conflicts: readonly Conflict[]): string {
  const parts = conflicts.map((c) =>
    c.field === "item"
      ? `${key(c.target)} is no longer there`
      : `${key(c.target)}'s ${c.field} is now ${JSON.stringify(c.actual)}, not ${JSON.stringify(c.expected)}`,
  );
  return `Changed in the source since it was applied, so nothing was overwritten: ${parts.join("; ")}.`;
}

export function changeSets(deps: ChangeSetDeps): ChangeSets {
  const { db } = deps;
  const rows = store(db);
  // Change sets this instance is applying; a second apply is refused until the
  // first returns, so no mutation is sent twice at once.
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

  const reader = (kind: SourceKind): Reader => deps.sources[kind].reader;

  // Lines for the rows of `set` as loaded, so `set.hash` is the hash of exactly
  // what is rendered. Applied lines show what the source reported; pending
  // ones read live values, carried forward through earlier lines.
  const render = async (set: ChangeSet): Promise<Diff> => {
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
      const { kind, spec } = mustSpec(m);
      const entry = wanted.get(item) ?? { kind, fields: new Set([catalogues[kind].titleField]) };
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
      const field = catalogues[kind].titleField;
      const values = live.get(id) ?? (await reader(kind).current(id, [field]));
      return values === "gone" ? null : text(values[field]);
    };

    // Field values per item (or new item's ref) as earlier lines leave them.
    const state = new Map<string, Record<string, unknown>>();
    const lines: Diff["lines"] = [];
    for (const m of set.mutations) {
      const { kind, spec } = mustSpec(m);
      const catalogue = catalogues[kind];
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
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
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
    return { changeSetId: set.id, hash: set.hash, lines };
  };

  // Records what the diff showed against each pending mutation, unless the
  // rows changed while it was being rendered.
  const keepPreview = (set: ChangeSet, diff: Diff): void =>
    transaction(db, () => {
      if (rows.load(set.id)?.hash !== set.hash) return;
      const pending = new Set(set.mutations.filter((m) => m.status !== "applied").map((m) => m.id));
      for (const line of diff.lines) {
        if (!pending.has(line.mutationId)) continue;
        rows.setPreview(
          line.mutationId,
          Object.fromEntries(line.fields.map((f) => [f.name, f.before])),
        );
      }
    });

  const diff = async (set: ChangeSet): Promise<Diff> => {
    const rendered = await render(set);
    keepPreview(set, rendered);
    return rendered;
  };

  // Conflicts between the source now and what each listed field was left at
  // after apply: per item and field, the last applied mutation's `after`.
  // A gone item is one conflict on its field "item", against the last mutation
  // that touched it.
  const conflictsWith = async (applied: readonly MutationRecord[]): Promise<Conflict[]> => {
    type Expected = { last: Ulid; fields: Map<string, { value: unknown; mutationId: Ulid }> };
    const expected = new Map<ItemId, Expected>();
    for (const m of applied) {
      if (!m.applied) continue;
      const entry = expected.get(m.applied.item.id) ?? { last: m.id, fields: new Map() };
      entry.last = m.id;
      for (const [field, value] of Object.entries(m.applied.after))
        entry.fields.set(field, { value, mutationId: m.id });
      expected.set(m.applied.item.id, entry);
    }
    const conflicts: Conflict[] = [];
    for (const [item, { last, fields }] of expected) {
      const kind = parseItemId(item)?.source;
      if (!kind || fields.size === 0) continue;
      const current = await deps.sources[kind].writer.current(item, [...fields.keys()]);
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
        if (!sameValue(actual, value))
          conflicts.push({ mutationId, target: item, field, expected: value, actual });
      }
    }
    return conflicts;
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

  const applyOnce = async (id: string) => {
    const first = mustLoad(id);
    const report = {
      changeSetId: first.id,
      applied: [] as Ulid[],
      skipped: [] as Ulid[],
      failed: [] as { mutationId: Ulid; error: string }[],
    };
    const fail = (mutationId: Ulid, error: string) => {
      rows.markFailed(mutationId, error);
      report.failed.push({ mutationId, error });
    };

    for (const { id: mutationId } of first.mutations) {
      let { set, m } = approved(id, mutationId);
      // A removal changes the hash, so a missing row can't pass the check.
      if (!m) continue;
      if (m.status === "applied") {
        report.skipped.push(mutationId);
        continue;
      }
      // A reverse mutation rechecks the mutation it undoes: the source may
      // have changed since the revert was built.
      if (m.reverts) {
        const original = rows.mutation(m.reverts);
        const conflicts = original ? await conflictsWith([original]) : [];
        if (conflicts.length) {
          fail(mutationId, conflictText(conflicts));
          continue;
        }
        ({ set, m } = approved(id, mutationId));
        if (!m) continue;
      }

      // From the check above to the write nothing awaits, so the rows whose
      // hash matched the approval are the rows sent.
      const where = resolve(m, set);
      if ("failed" in where) {
        fail(mutationId, where.failed);
        continue;
      }
      const { kind } = mustSpec(m);
      const request = mint({ mutationId: m.id, op: m.op, target: where.target, args: m.args });
      let result: unknown;
      try {
        result = await deps.sources[kind].writer.apply(request);
      } catch (error) {
        fail(mutationId, message(error));
        continue;
      }
      const checked = writeResult(result);
      if (!checked.ok) {
        fail(
          mutationId,
          `the source answered in a shape Oriel can't read, so the change may have been made: ${JSON.stringify(checked.issues)}`,
        );
        continue;
      }
      rows.markApplied(mutationId, { ...checked.value, at: deps.now() });
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
      const drafts = check(parsed.value);
      const { now, ms } = at();
      const id = ulid(ms);
      transaction(db, () => {
        rows.insertChangeSet({
          id,
          workspaceId: owner.value.workspaceId,
          threadId: owner.value.threadId,
          runId: owner.value.id,
          revertOf: null,
          createdAt: now,
        });
        drafts.forEach((m, i) =>
          rows.insertMutation(owner.value.workspaceId, id, {
            ...m,
            id: ulid(ms),
            seq: i + 1,
            reverts: null,
          }),
        );
      });
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
        for (const mutationId of remove) rows.remove(current.id, mutationId);
        kept.forEach((m, i) => {
          if (changes.has(m.id)) rows.setArgs(current.id, m.id, checked[i]?.args);
        });
        return current;
      });
      deps.emit({
        name: "changeset.edited",
        at: deps.now(),
        workspaceId: changed.workspaceId,
        changeSetId: changed.id,
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

    async revert(id) {
      const set = mustLoad(id);
      const applied = set.mutations.filter((m) => m.applied !== null);
      if (applied.length === 0)
        throw new ChangeSetError("not-revertible", "nothing in this change set has been applied");
      const undo = [...applied].reverse().map((m) => {
        if (!m.applied) throw new Error("unreachable: filtered to applied mutations");
        const { spec } = mustSpec(m);
        const step = spec.undo(m.args, m.applied);
        if ("refused" in step)
          throw new ChangeSetError(
            "not-revertible",
            `mutation ${m.seq} (${m.op}) can't be reverted: ${step.refused}`,
          );
        return {
          reverts: m.id,
          op: step.op,
          target: m.applied.item.id,
          ref: null,
          args: step.args,
        };
      });

      const conflicts = await conflictsWith(applied);
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

      const drafts = check(undo);
      const { now, ms } = at();
      const reverseId = ulid(ms);
      transaction(db, () => {
        rows.insertChangeSet({
          id: reverseId,
          workspaceId: set.workspaceId,
          threadId: set.threadId,
          runId: null,
          revertOf: set.id,
          createdAt: now,
        });
        drafts.forEach((m, i) =>
          rows.insertMutation(set.workspaceId, reverseId, {
            ...m,
            id: ulid(ms),
            seq: i + 1,
            reverts: undo[i]?.reverts ?? null,
          } satisfies NewMutation),
        );
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
