// Groups and their versioned membership (decision 0018). Each change takes
// the group's next version and records what caused it; a region is the
// membership at one version. Members are matched by source and stable ID, so
// an item that moved (a new handle, the same stable ID) is the same member.
import type { DatabaseSync } from "node:sqlite";
import {
  type Group,
  type GroupChange,
  type GroupMember,
  type GroupOrigin,
  type Instant,
  isInstant,
  isItemId,
  isUlid,
  literal,
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

const groupOrigin: Validator<GroupOrigin> = union(
  object({
    kind: literal("cluster"),
    grouping: string,
    cluster: string,
    anchor: nullable(object({ id: itemIdValue, stableId: string })),
  }),
  object({ kind: literal("picked") }),
  object({ kind: literal("thread") }),
);
const cause: Validator<GroupChange["cause"]> = union(
  object({ kind: literal("user") }),
  object({ kind: literal("change-set"), changeSetId: ulidValue }),
);

const groupRow = object({
  id: ulidValue,
  workspace_id: ulidValue,
  name: string,
  origin: string,
  created_at: refine(string, isInstant, "expected an instant"),
  version: number,
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
function distinct(members: readonly GroupMember[]): (GroupMember & { source: string })[] {
  const seen = new Map<string, GroupMember & { source: string }>();
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

export type GroupStore = ReturnType<typeof groupStore>;

export function groupStore(db: DatabaseSync) {
  const insertGroup = db.prepare(
    "insert into groups (id, workspace_id, name, origin, created_at) values (?, ?, ?, ?, ?)",
  );
  const selectGroup = db.prepare(`
    select g.id, g.workspace_id, g.name, g.origin, g.created_at, max(c.version) as version
    from groups g join group_changes c on c.group_id = g.id
    where g.id = ? group by g.id`);
  const insertChange = db.prepare(
    "insert into group_changes (workspace_id, group_id, version, at, cause) values (?, ?, ?, ?, ?)",
  );
  const insertMember = db.prepare(`
    insert into group_members (workspace_id, group_id, source, stable_id, item_id, added_version)
    values (?, ?, ?, ?, ?, ?)`);
  const selectLive = db.prepare(`
    select stable_id, item_id, added_version, removed_version from group_members
    where group_id = ? and source = ? and stable_id = ? and removed_version is null`);
  const removeMember = db.prepare(`
    update group_members set removed_version = ?
    where group_id = ? and source = ? and stable_id = ? and removed_version is null`);
  const selectAt = db.prepare(`
    select stable_id, item_id, added_version, removed_version from group_members
    where group_id = ? and added_version <= ? and (removed_version is null or removed_version > ?)
    order by added_version, item_id`);
  const selectChange = db.prepare(
    "select version, at, cause from group_changes where group_id = ? and version = ?",
  );
  const selectByWorkspace = db.prepare(
    "select id from groups where workspace_id = ? order by created_at desc, id desc",
  );
  const selectChanges = db.prepare(
    "select version, at, cause from group_changes where group_id = ? and version > ? order by version",
  );
  const selectTouched = db.prepare(`
    select stable_id, item_id, added_version, removed_version from group_members
    where group_id = ? and (added_version = ? or removed_version = ?)
    order by item_id`);

  const get = (id: Ulid): Group | null => {
    const raw = selectGroup.get(id);
    if (!raw) return null;
    const row = parse(groupRow, raw, "groups row");
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      origin: parse(groupOrigin, JSON.parse(row.origin), "group origin"),
      version: row.version,
      createdAt: row.created_at,
    };
  };

  const mustGet = (id: Ulid): Group => {
    const group = get(id);
    if (!group) throw new RangeError(`no group ${id}`);
    return group;
  };

  const member = (raw: unknown): GroupMember => {
    const row = parse(memberRow, raw, "group_members row");
    return { id: row.item_id, stableId: row.stable_id };
  };

  const change = (groupId: Ulid, raw: unknown): GroupChange => {
    const row = parse(changeRow, raw, "group_changes row");
    const touched = selectTouched.all(groupId, row.version, row.version);
    const rows = touched.map((one) => parse(memberRow, one, "group_members row"));
    const as = (r: (typeof rows)[number]) => ({ id: r.item_id, stableId: r.stable_id });
    return {
      groupId,
      version: row.version,
      at: row.at,
      added: rows.filter((r) => r.added_version === row.version).map(as),
      removed: rows.filter((r) => r.removed_version === row.version).map(as),
      cause: parse(cause, JSON.parse(row.cause), "group change cause"),
    };
  };

  // In one transaction: picks the members a change would touch, and only if
  // there are any, records the next version and applies the change to them.
  const next = (
    groupId: Ulid,
    members: readonly GroupMember[],
    why: GroupChange["cause"],
    now: Instant,
    touches: (live: boolean) => boolean,
    apply: (group: Group, version: number, m: GroupMember & { source: string }) => void,
  ): GroupChange | null => {
    const checked = parse(cause, why, "cause");
    const wanted = distinct(members);
    return transaction(db, () => {
      const group = mustGet(groupId);
      const touched = wanted.filter((m) =>
        touches(selectLive.get(groupId, m.source, m.stableId) !== undefined),
      );
      if (touched.length === 0) return null;
      const version = group.version + 1;
      insertChange.run(group.workspaceId, groupId, version, now, JSON.stringify(checked));
      for (const m of touched) apply(group, version, m);
      return change(groupId, selectChange.get(groupId, version));
    });
  };

  return {
    get,

    // A group's name is the user's label for it, not part of its membership,
    // so renaming takes no version.
    rename(groupId: Ulid, name: string): void {
      const { changes } = db.prepare("update groups set name = ? where id = ?").run(name, groupId);
      if (Number(changes) !== 1) throw new RangeError(`no group ${groupId}`);
    },

    // A workspace's groups, newest first.
    list(workspaceId: Ulid): Group[] {
      return selectByWorkspace.all(workspaceId).map((raw) => {
        const row = parse(object({ id: ulidValue }), raw, "groups row");
        return mustGet(row.id);
      });
    },

    // A new group at version 1, holding `members`.
    create(
      group: { id: Ulid; workspaceId: Ulid; name: string; origin: GroupOrigin },
      members: readonly GroupMember[],
      now: Instant,
    ): Group {
      const origin = parse(groupOrigin, group.origin, "group origin");
      const added = distinct(members);
      transaction(db, () => {
        insertGroup.run(group.id, group.workspaceId, group.name, JSON.stringify(origin), now);
        insertChange.run(group.workspaceId, group.id, 1, now, JSON.stringify({ kind: "user" }));
        for (const m of added)
          insertMember.run(group.workspaceId, group.id, m.source, m.stableId, m.id, 1);
      });
      return mustGet(group.id);
    },

    // Adds the members the group doesn't hold yet, as its next version. One it
    // holds under another handle, as after a move, is already there. Null
    // when nothing changes.
    add(
      groupId: Ulid,
      members: readonly GroupMember[],
      why: GroupChange["cause"],
      now: Instant,
    ): GroupChange | null {
      return next(
        groupId,
        members,
        why,
        now,
        (live) => !live,
        (group, version, m) =>
          insertMember.run(group.workspaceId, groupId, m.source, m.stableId, m.id, version),
      );
    },

    // Removes the members the group holds, by source and stable ID, as its
    // next version. Null when nothing changes.
    remove(
      groupId: Ulid,
      members: readonly GroupMember[],
      why: GroupChange["cause"],
      now: Instant,
    ): GroupChange | null {
      return next(
        groupId,
        members,
        why,
        now,
        (live) => live,
        (_group, version, m) => removeMember.run(version, groupId, m.source, m.stableId),
      );
    },

    // The group's membership at `version`, or null for a group or version
    // that doesn't exist. A version whose members no longer include the
    // item the group was made around has no anchor.
    region(groupId: Ulid, version: number): Region | null {
      const group = get(groupId);
      if (!group || !Number.isInteger(version) || version < 1 || version > group.version)
        return null;
      const items = selectAt.all(groupId, version, version).map(member);
      const { origin } = group;
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
        groupId,
        version,
        workspaceId: group.workspaceId,
        items,
        origin: origin.kind === "cluster" ? { ...origin, anchor: held ?? null } : origin,
      };
    },

    // The changes after `version`, oldest first: what a thread's markers say
    // when it catches up.
    changes(groupId: Ulid, after: number): GroupChange[] {
      return selectChanges.all(groupId, after).map((raw) => change(groupId, raw));
    },
  };
}
