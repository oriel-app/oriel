// None keeps a secret. The server makes every connection's ID; the page only names one it has.
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

    get: (id: Ulid): Connection | null => store.get(workspaceId, id),

    configure(connection: Connection, options: Record<string, unknown>): void {
      store.configure(workspaceId, connection.id, options);
    },

    settle(connection: Connection, settings: ConnectionSettings): void {
      store.settle(workspaceId, connection.id, settings);
    },

    first(kind: SourceKind): Connection | null {
      return store.live(workspaceId, kind)[0] ?? null;
    },

    planned: (kind: SourceKind, identity: string) => store.planned(workspaceId, kind, identity),

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

    // A database is one per set of modes, so what a flag names changes only when the flag does.
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

    disconnect(connection: Connection): void {
      store.disconnect(workspaceId, connection.id, now());
      index.forget(workspaceId, connection.prefix, now());
      log("connections: disconnected", { kind: connection.kind, number: connection.number });
    },
  };
}
