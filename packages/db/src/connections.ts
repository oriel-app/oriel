// A workspace's connections (decision 0049): what a person connected through
// each connector, with its options and never its secret. One is live until
// it's disconnected, which leaves a tombstone that connecting the same thing
// again revives, with its ID and number, so its items come back under the
// IDs they had.
import type { DatabaseSync } from "node:sqlite";
import {
  type Instant,
  isInstant,
  isUlid,
  nullable,
  number,
  object,
  prefixOf,
  refine,
  type SourceKind,
  string,
  type Ulid,
} from "@oriel/core";
import { transaction } from "./open.ts";

const connectionRow = object({
  id: refine(string, isUlid, "expected a ULID"),
  kind: string,
  number: refine(number, Number.isSafeInteger, "expected a whole number"),
  identity: string,
  name: nullable(string),
  options: string,
  sync_every: nullable(number),
  connected_at: refine(string, isInstant, "expected an instant"),
  disconnected_at: nullable(refine(string, isInstant, "expected an instant")),
});

export type Connection = {
  id: Ulid;
  kind: SourceKind;
  number: number;
  // Whose its items are: `jira` for the first of a kind, `jira.2` for the next.
  prefix: string;
  // What identifies it in its source, such as Jira's site or a folder's path.
  identity: string;
  // The person's name for it; null for its connector's.
  name: string | null;
  options: Record<string, unknown>;
  // How often it syncs while Oriel is open, in minutes; null for when
  // Oriel starts and when asked.
  every: number | null;
  connectedAt: Instant;
  // When it was disconnected: a tombstone. Null while it's live.
  disconnectedAt: Instant | null;
};

export type ConnectionStore = ReturnType<typeof connectionStore>;

export function connectionStore(db: DatabaseSync) {
  const columns =
    "id, kind, number, identity, name, options, sync_every, connected_at, disconnected_at from connections";
  const selectAll = db.prepare(`select ${columns} where workspace_id = ? order by kind, number`);
  const selectById = db.prepare(`select ${columns} where workspace_id = ? and id = ?`);
  const selectByIdentity = db.prepare(
    `select ${columns} where workspace_id = ? and kind = ? and identity = ?`,
  );
  const selectLast = db.prepare(
    "select coalesce(max(number), 0) as number from connections where workspace_id = ? and kind = ?",
  );
  const insert = db.prepare(`
    insert into connections
      (id, workspace_id, kind, number, identity, name, options, connected_at, disconnected_at)
    values (?, ?, ?, ?, ?, null, ?, ?, null)`);
  const revive = db.prepare(`
    update connections set options = ?, connected_at = ?, disconnected_at = null
    where workspace_id = ? and id = ? and disconnected_at is not null`);
  const updateOptions = db.prepare(
    "update connections set options = ? where workspace_id = ? and id = ? and disconnected_at is null",
  );
  const updateIdentity = db.prepare(
    "update connections set identity = ? where workspace_id = ? and id = ? and disconnected_at is null",
  );
  const updateSettings = db.prepare(`
    update connections set name = ?, sync_every = ?
    where workspace_id = ? and id = ? and disconnected_at is null`);
  const tombstone = db.prepare(`
    update connections set options = '{}', name = null, sync_every = null,
      disconnected_at = ?
    where workspace_id = ? and id = ? and disconnected_at is null`);

  const read = (raw: unknown): Connection => {
    const row = connectionRow(raw);
    if (!row.ok) throw new Error(`corrupt connections row: ${JSON.stringify(row.issues)}`);
    const { id, kind, number, identity, name, sync_every, connected_at, disconnected_at } =
      row.value;
    const options: unknown = JSON.parse(row.value.options);
    return {
      id,
      kind,
      number,
      prefix: prefixOf(kind, number),
      identity,
      name,
      options: options as Record<string, unknown>,
      every: sync_every,
      connectedAt: connected_at,
      disconnectedAt: disconnected_at,
    };
  };
  const byIdentity = (workspaceId: Ulid, kind: SourceKind, identity: string) => {
    const raw = selectByIdentity.get(workspaceId, kind, identity);
    return raw ? read(raw) : null;
  };
  const nextNumber = (workspaceId: Ulid, kind: SourceKind) =>
    Number(selectLast.get(workspaceId, kind)?.number ?? 0) + 1;

  return {
    // Every connection, live and tombstones, by kind and then number.
    list(workspaceId: Ulid): Connection[] {
      return selectAll.all(workspaceId).map(read);
    },

    // The live connections of a kind, the first first.
    live(workspaceId: Ulid, kind: SourceKind): Connection[] {
      return selectAll
        .all(workspaceId)
        .map(read)
        .filter((c) => c.kind === kind && c.disconnectedAt === null);
    },

    get(workspaceId: Ulid, id: Ulid): Connection | null {
      const raw = selectById.get(workspaceId, id);
      return raw ? read(raw) : null;
    },

    // What connecting this thing would be, without connecting it: the live
    // connection that has it, the tombstone it would revive, or the number a
    // new one would take.
    planned(
      workspaceId: Ulid,
      kind: SourceKind,
      identity: string,
    ): { live: Connection } | { revives: Connection } | { number: number } {
      const found = byIdentity(workspaceId, kind, identity);
      if (found) return found.disconnectedAt === null ? { live: found } : { revives: found };
      return { number: nextNumber(workspaceId, kind) };
    },

    // Connects a thing: a tombstone of it comes back with its ID and number,
    // and anything else is new, under `id` and the next number of its kind.
    // One a live connection already has is refused, with that one.
    connect(
      workspaceId: Ulid,
      made: { id: Ulid; kind: SourceKind; identity: string; options: Record<string, unknown> },
      now: Instant,
    ): { connection: Connection; revived: boolean } | { taken: Connection } {
      return transaction(db, () => {
        const options = JSON.stringify(made.options);
        const found = byIdentity(workspaceId, made.kind, made.identity);
        if (found?.disconnectedAt === null) return { taken: found };
        if (found) revive.run(options, now, workspaceId, found.id);
        else
          insert.run(
            made.id,
            workspaceId,
            made.kind,
            nextNumber(workspaceId, made.kind),
            made.identity,
            options,
            now,
          );
        const connection = byIdentity(workspaceId, made.kind, made.identity);
        if (!connection) throw new Error("a connection made just now isn't there");
        return { connection, revived: found !== null };
      });
    },

    // A live connection's options, in place of the ones before.
    configure(workspaceId: Ulid, id: Ulid, options: Record<string, unknown>): boolean {
      return updateOptions.run(JSON.stringify(options), workspaceId, id).changes > 0;
    },

    // A live connection's name and how often it syncs, in place of the
    // ones before.
    settle(
      workspaceId: Ulid,
      id: Ulid,
      settings: { name: string | null; every: number | null },
    ): boolean {
      return updateSettings.run(settings.name, settings.every, workspaceId, id).changes > 0;
    },

    // A live connection that names another thing now, as a flag's does when
    // `.env` changes. Refused while another connection, a tombstone too,
    // has that thing.
    repoint(workspaceId: Ulid, id: Ulid, identity: string): void {
      const raw = selectById.get(workspaceId, id);
      const current = raw ? read(raw) : null;
      if (!current) throw new Error("no such connection");
      if (byIdentity(workspaceId, current.kind, identity))
        throw new Error(`another ${current.kind} connection has that, so this one can't`);
      updateIdentity.run(identity, workspaceId, id);
    },

    // Leaves a tombstone: its ID, kind, number and identity, with its options,
    // name and settings gone. False when it wasn't live.
    disconnect(workspaceId: Ulid, id: Ulid, now: Instant): boolean {
      return tombstone.run(now, workspaceId, id).changes > 0;
    },
  };
}
