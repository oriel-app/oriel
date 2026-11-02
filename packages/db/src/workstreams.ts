// Workstreams and their versioned membership (decision 0018). Each change takes
// the workstream's next version and records what caused it; a region is the
// membership at one version. Members are matched by source and stable ID, so
// an item that moved (a new handle, the same stable ID) is the same member.
import type { DatabaseSync } from "node:sqlite";
import {
  type Workstream,
  type WorkstreamChange,
  type WorkstreamMember,
  type WorkstreamOrigin,
  type Instant,
  isInstant,
  isItemId,
  isUlid,
  literal,
  holderName,
  nullable,
  number,
  object,
  parseItemId,
  type Region,
  refine,
  string,
  type Ulid,
  union,
  type Validator,
} from "@oriel/core";
import { transaction } from "./open.ts";

const ulidValue = refine(string, isUlid, "expected a ULID");
const itemIdValue = refine(string, isItemId, "expected an item ID");

const workstreamOrigin: Validator<WorkstreamOrigin> = union(
  object({
    kind: literal("cluster"),
    grouping: string,
    cluster: string,
    anchor: nullable(object({ id: itemIdValue, stableId: string })),
  }),
  object({ kind: literal("picked") }),
  object({ kind: literal("thread") }),
);
const cause: Validator<WorkstreamChange["cause"]> = union(
  object({ kind: literal("user") }),
  object({ kind: literal("agent"), threadId: ulidValue }),
  object({ kind: literal("tool"), name: string }),
  object({ kind: literal("review-link"), by: holderName }),
  object({ kind: literal("change-set"), changeSetId: ulidValue }),
);

const workstreamRow = object({
  id: ulidValue,
  workspace_id: ulidValue,
  name: string,
  origin: string,
  created_at: refine(string, isInstant, "expected an instant"),
  version: number,
  user_named: number,
});
const changeRow = object({
  version: number,
  at: refine(string, isInstant, "expected an instant"),
  cause: string,
});
const memberRow = object({
  stable_id: string,
  item_id: itemIdValue,
  added_version: number,
  removed_version: nullable(number),
});

function parse<T>(validator: Validator<T>, raw: unknown, what: string): T {
  const result = validator(raw);
  if (!result.ok) throw new Error(`corrupt ${what}: ${JSON.stringify(result.issues)}`);
  return result.value;
}

// The same item named twice counts once; an ID with no source or an empty
// stable ID is refused.
function distinct(members: readonly WorkstreamMember[]): (WorkstreamMember & { source: string })[] {
  const seen = new Map<string, WorkstreamMember & { source: string }>();
  for (const member of members) {
    const source = parseItemId(member.id)?.source;
    if (!source) throw new RangeError(`not an item ID: ${JSON.stringify(member.id)}`);
    if (typeof member.stableId !== "string" || member.stableId === "")
      throw new RangeError(`${member.id} has no stable ID`);
    const key = `${source}\u0000${member.stableId}`;
    if (!seen.has(key)) seen.set(key, { id: member.id, stableId: member.stableId, source });
  }
  return [...seen.values()];
}

// Everything a workstream holds, then the workstream: what deleting one
// takes. A thread names its workstream, so none may be left to.
export const dropWorkstream = [
  "delete from workstream_members where workstream_id = ?",
  "delete from workstream_changes where workstream_id = ?",
  "delete from user_named_workstreams where workstream_id = ?",
  "delete from workstreams where id = ?",
];

export type WorkstreamStore = ReturnType<typeof workstreamStore>;

export function workstreamStore(db: DatabaseSync) {
  const insertWorkstream = db.prepare(
    "insert into workstreams (id, workspace_id, name, origin, created_at) values (?, ?, ?, ?, ?)",
  );
  const selectWorkstream = db.prepare(`
    select g.id, g.workspace_id, g.name, g.origin, g.created_at, max(c.version) as version,
      exists (select 1 from user_named_workstreams u where u.workstream_id = g.id) as user_named
    from workstreams g join workstream_changes c on c.workstream_id = g.id
    where g.id = ? group by g.id`);
  const nameByUser = db.prepare("update workstreams set name = ? where id = ?");
  const markUserNamed = db.prepare(
    "insert or ignore into user_named_workstreams (workspace_id, workstream_id) select workspace_id, id from workstreams where id = ?",
  );
  const unmarkUserNamed = db.prepare("delete from user_named_workstreams where workstream_id = ?");
  const nameByOriel = db.prepare(`
    update workstreams set name = ? where id = ? and name != ?
      and not exists (select 1 from user_named_workstreams where workstream_id = workstreams.id)`);
  const insertChange = db.prepare(
    "insert into workstream_changes (workspace_id, workstream_id, version, at, cause) values (?, ?, ?, ?, ?)",
  );
  const insertMember = db.prepare(`
    insert into workstream_members (workspace_id, workstream_id, source, stable_id, item_id, added_version)
    values (?, ?, ?, ?, ?, ?)`);
  const selectLive = db.prepare(`
    select stable_id, item_id, added_version, removed_version from workstream_members
    where workstream_id = ? and source = ? and stable_id = ? and removed_version is null`);
  const removeMember = db.prepare(`
    update workstream_members set removed_version = ?
    where workstream_id = ? and source = ? and stable_id = ? and removed_version is null`);
  const selectAt = db.prepare(`
    select stable_id, item_id, added_version, removed_version from workstream_members
    where workstream_id = ? and added_version <= ? and (removed_version is null or removed_version > ?)
    order by added_version, item_id`);
  const selectChange = db.prepare(
    "select version, at, cause from workstream_changes where workstream_id = ? and version = ?",
  );
  const selectByWorkspace = db.prepare(
    "select id from workstreams where workspace_id = ? order by created_at desc, id desc",
  );
  const selectChanges = db.prepare(
    "select version, at, cause from workstream_changes where workstream_id = ? and version > ? order by version",
  );
  // A thread works in it, or one deleted and kept for what it wrote did.
  const selectUsed = db.prepare("select 1 from threads where workstream_id = ? limit 1");
  const drop = dropWorkstream.map((sql) => db.prepare(sql));
  const selectTouched = db.prepare(`
    select stable_id, item_id, added_version, removed_version from workstream_members
    where workstream_id = ? and (added_version = ? or removed_version = ?)
    order by item_id`);

  const get = (id: Ulid): Workstream | null => {
    const raw = selectWorkstream.get(id);
    if (!raw) return null;
    const row = parse(workstreamRow, raw, "workstreams row");
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      namedBy: row.user_named ? "user" : "oriel",
      origin: parse(workstreamOrigin, JSON.parse(row.origin), "workstream origin"),
      version: row.version,
      createdAt: row.created_at,
    };
  };

  const mustGet = (id: Ulid): Workstream => {
    const workstream = get(id);
    if (!workstream) throw new RangeError(`no workstream ${id}`);
    return workstream;
  };

  const member = (raw: unknown): WorkstreamMember => {
    const row = parse(memberRow, raw, "workstream_members row");
    return { id: row.item_id, stableId: row.stable_id };
  };

  const change = (workstreamId: Ulid, raw: unknown): WorkstreamChange => {
    const row = parse(changeRow, raw, "workstream_changes row");
    const touched = selectTouched.all(workstreamId, row.version, row.version);
    const rows = touched.map((one) => parse(memberRow, one, "workstream_members row"));
    const as = (r: (typeof rows)[number]) => ({ id: r.item_id, stableId: r.stable_id });
    return {
      workstreamId,
      version: row.version,
      at: row.at,
      added: rows.filter((r) => r.added_version === row.version).map(as),
      removed: rows.filter((r) => r.removed_version === row.version).map(as),
      cause: parse(cause, JSON.parse(row.cause), "workstream change cause"),
    };
  };

  // In one transaction: picks the members a change would touch, and only if
  // there are any, records the next version and applies the change to them.
  const next = (
    workstreamId: Ulid,
    members: readonly WorkstreamMember[],
    why: WorkstreamChange["cause"],
    now: Instant,
    touches: (live: boolean) => boolean,
    apply: (
      workstream: Workstream,
      version: number,
      m: WorkstreamMember & { source: string },
    ) => void,
  ): WorkstreamChange | null => {
    const checked = parse(cause, why, "cause");
    const wanted = distinct(members);
    return transaction(db, () => {
      const workstream = mustGet(workstreamId);
      const touched = wanted.filter((m) =>
        touches(selectLive.get(workstreamId, m.source, m.stableId) !== undefined),
      );
      if (touched.length === 0) return null;
      const version = workstream.version + 1;
      insertChange.run(workstream.workspaceId, workstreamId, version, now, JSON.stringify(checked));
      for (const m of touched) apply(workstream, version, m);
      return change(workstreamId, selectChange.get(workstreamId, version));
    });
  };

  return {
    get,

    // A workstream's name is a label for it, not part of its membership, so
    // renaming takes no version. Once the user names a workstream, the name is
    // theirs: Oriel renaming it then changes nothing. A rename is the user's
    // unless it says otherwise. Says whether the name changed.
    rename(workstreamId: Ulid, name: string, by: Workstream["namedBy"] = "user"): boolean {
      if (by === "oriel") return Number(nameByOriel.run(name, workstreamId, name).changes) === 1;
      return transaction(db, () => {
        const before = mustGet(workstreamId).name;
        nameByUser.run(name, workstreamId);
        markUserNamed.run(workstreamId);
        return before !== name;
      });
    },

    // Gives a workstream's name back to Oriel, as it was before the user named
    // it, so Oriel may name it again: what undoing the user's rename does.
    giveBack(workstreamId: Ulid, name: string): void {
      transaction(db, () => {
        mustGet(workstreamId);
        nameByUser.run(name, workstreamId);
        unmarkUserNamed.run(workstreamId);
      });
    },

    // Deletes the workstream with its log, unless a thread uses it. Says
    // whether it did.
    delete(workstreamId: Ulid): boolean {
      return transaction(db, () => {
        mustGet(workstreamId);
        if (selectUsed.get(workstreamId) !== undefined) return false;
        for (const statement of drop) statement.run(workstreamId);
        return true;
      });
    },

    // A workspace's workstreams, newest first.
    list(workspaceId: Ulid): Workstream[] {
      return selectByWorkspace.all(workspaceId).map((raw) => {
        const row = parse(object({ id: ulidValue }), raw, "workstreams row");
        return mustGet(row.id);
      });
    },

    // A new workstream at version 1, holding `members`; its first version
    // records who made it, the user unless it says otherwise.
    create(
      workstream: { id: Ulid; workspaceId: Ulid; name: string; origin: WorkstreamOrigin },
      members: readonly WorkstreamMember[],
      now: Instant,
      why: WorkstreamChange["cause"] = { kind: "user" },
    ): Workstream {
      const origin = parse(workstreamOrigin, workstream.origin, "workstream origin");
      const checked = parse(cause, why, "cause");
      const added = distinct(members);
      transaction(db, () => {
        insertWorkstream.run(
          workstream.id,
          workstream.workspaceId,
          workstream.name,
          JSON.stringify(origin),
          now,
        );
        insertChange.run(workstream.workspaceId, workstream.id, 1, now, JSON.stringify(checked));
        for (const m of added)
          insertMember.run(workstream.workspaceId, workstream.id, m.source, m.stableId, m.id, 1);
      });
      return mustGet(workstream.id);
    },

    // Adds the members the workstream doesn't hold yet, as its next version. One it
    // holds under another handle, as after a move, is already there. Null
    // when nothing changes.
    add(
      workstreamId: Ulid,
      members: readonly WorkstreamMember[],
      why: WorkstreamChange["cause"],
      now: Instant,
    ): WorkstreamChange | null {
      return next(
        workstreamId,
        members,
        why,
        now,
        (live) => !live,
        (workstream, version, m) =>
          insertMember.run(
            workstream.workspaceId,
            workstreamId,
            m.source,
            m.stableId,
            m.id,
            version,
          ),
      );
    },

    // Removes the members the workstream holds, by source and stable ID, as its
    // next version. Null when nothing changes.
    remove(
      workstreamId: Ulid,
      members: readonly WorkstreamMember[],
      why: WorkstreamChange["cause"],
      now: Instant,
    ): WorkstreamChange | null {
      return next(
        workstreamId,
        members,
        why,
        now,
        (live) => live,
        (_workstream, version, m) => removeMember.run(version, workstreamId, m.source, m.stableId),
      );
    },

    // The workstream's membership at `version`, or null for a workstream or version
    // that doesn't exist. A version whose members no longer include the
    // item the workstream was made around has no anchor.
    region(workstreamId: Ulid, version: number): Region | null {
      const workstream = get(workstreamId);
      if (!workstream || !Number.isInteger(version) || version < 1 || version > workstream.version)
        return null;
      const items = selectAt.all(workstreamId, version, version).map(member);
      const { origin } = workstream;
      const anchor = origin.kind === "cluster" ? origin.anchor : null;
      // By source and stable ID: an epic that moved projects and was added
      // back under its new handle is still the anchor.
      const held =
        anchor &&
        items.find(
          (item) =>
            item.stableId === anchor.stableId &&
            parseItemId(item.id)?.source === parseItemId(anchor.id)?.source,
        );
      return {
        workstreamId,
        version,
        workspaceId: workstream.workspaceId,
        items,
        origin: origin.kind === "cluster" ? { ...origin, anchor: held ?? null } : origin,
      };
    },

    // The changes after `version`, oldest first: what a thread's markers say
    // when it catches up.
    changes(workstreamId: Ulid, after: number): WorkstreamChange[] {
      return selectChanges.all(workstreamId, after).map((raw) => change(workstreamId, raw));
    },
  };
}
