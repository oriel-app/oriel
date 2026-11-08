// A workspace's connections as the server keeps them (decision 0049): each
// one's options in the database, and its items in the index under its
// prefix. None keeps a secret (decision 0059). The server makes every
// connection's ID; the page only names one it has.
import type { DatabaseSync } from "node:sqlite";
import type { ConnectionSettings, Instant, Log, SourceKind, Ulid } from "@oriel/core";
import { type Connection, connectionStore, type IndexStore } from "@oriel/db";

export type Connections = ReturnType<typeof connectionsOf>;

export function connectionsOf(deps: {
  db: DatabaseSync;
  index: IndexStore;
  workspaceId: Ulid;
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
}) {
  const { index, workspaceId, now, newId, log } = deps;
  const store = connectionStore(deps.db);

  return {
    list: () => store.list(workspaceId),

    // One by its ID, live or a tombstone; null when this workspace has none.
    get: (id: Ulid): Connection | null => store.get(workspaceId, id),

    // Sets a live connection's options, which its next sync reads with.
    configure(connection: Connection, options: Record<string, unknown>): void {
      store.configure(workspaceId, connection.id, options);
    },

    // Sets a live connection's name and how often it syncs.
    settle(connection: Connection, settings: ConnectionSettings): void {
      store.settle(workspaceId, connection.id, settings);
    },

    // A kind's first live connection, the one each kind's source opens until
    // a kind can have several.
    first(kind: SourceKind): Connection | null {
      return store.live(workspaceId, kind)[0] ?? null;
    },

    planned: (kind: SourceKind, identity: string) => store.planned(workspaceId, kind, identity),

    // Connects a thing, or finds the live connection that has it. A new one
    // takes `id` when given, as from `planned`, and a new one otherwise.
    connect(made: {
      id?: Ulid;
      kind: SourceKind;
      identity: string;
      options: Record<string, unknown>;
    }): { connection: Connection; revived: boolean } | { taken: Connection } {
      const plan = store.planned(workspaceId, made.kind, made.identity);
      if ("live" in plan) return { taken: plan.live };
      const id = "revives" in plan ? plan.revives.id : (made.id ?? newId());
      return store.connect(
        workspaceId,
        { id, kind: made.kind, identity: made.identity, options: made.options },
        now(),
      );
    },

    // A connection a flag makes at start, under `pnpm dev`, for fixtures and
    // tests: its kind's first, which follows its flag. A database is one per
    // set of modes, so what a flag names changes only when the flag does,
    // and then its items follow it, as a kind's did before connections.
    flagged(kind: SourceKind, identity: string, options: Record<string, unknown>): Connection {
      const live = store.live(workspaceId, kind)[0];
      if (live && live.identity !== identity) store.repoint(workspaceId, live.id, identity);
      const made = live
        ? null
        : store.connect(workspaceId, { id: newId(), kind, identity, options }, now());
      const first = live ?? (made && "connection" in made ? made.connection : null);
      if (first?.number !== 1)
        throw new Error(
          `${kind}'s first connection was disconnected, and a flag can't make a later one`,
        );
      store.configure(workspaceId, first.id, options);
      return { ...first, identity, options };
    },

    // Disconnects: a tombstone left, and its items, their change log and the
    // references they made forgotten. Workstreams that hold its items keep
    // them, as items the index no longer has, and threads keep what was
    // said.
    disconnect(connection: Connection): void {
      store.disconnect(workspaceId, connection.id, now());
      index.forget(workspaceId, connection.prefix, now());
      log("connections: disconnected", { kind: connection.kind, number: connection.number });
    },
  };
}
