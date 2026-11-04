// A workspace's connections as the server keeps them (decision 0049): each
// one's options in the database, its secret in the store for secrets under
// the name made from its ID, and its items in the index under its prefix.
// The server makes every connection's ID; the page only names one it has.
import type { DatabaseSync } from "node:sqlite";
import type { ConnectionSettings, Instant, Log, SourceKind, Ulid } from "@oriel/core";
import { type Connection, connectionStore, type IndexStore } from "@oriel/db";
import { secretName, type Secrets } from "./connection.ts";

export type Connections = ReturnType<typeof connectionsOf>;

export function connectionsOf(deps: {
  db: DatabaseSync;
  index: IndexStore;
  secrets: Secrets;
  workspaceId: Ulid;
  now: () => Instant;
  newId: () => Ulid;
  log: Log;
}) {
  const { index, secrets, workspaceId, now, newId, log } = deps;
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

    // Its secret, or null when there's none or the store didn't answer. Why
    // is logged, never the value.
    async secret(connection: Connection): Promise<string | null> {
      try {
        return await secrets.get(secretName(connection.id));
      } catch {
        log("connections: the store for secrets didn't answer", { kind: connection.kind });
        return null;
      }
    },

    // Connects a thing, or finds the live connection that has it. Its secret
    // is kept first, under the ID the connection will have, so none is ever
    // without the secret it was given; a store that can't keep it throws,
    // and nothing is connected. A new one takes `id` when given, as from
    // `planned`, and a new one otherwise.
    async connect(made: {
      id?: Ulid;
      kind: SourceKind;
      identity: string;
      options: Record<string, unknown>;
      secret?: string;
    }): Promise<{ connection: Connection; revived: boolean } | { taken: Connection }> {
      const plan = store.planned(workspaceId, made.kind, made.identity);
      if ("live" in plan) return { taken: plan.live };
      const id = "revives" in plan ? plan.revives.id : (made.id ?? newId());
      if (made.secret !== undefined) await secrets.set(secretName(id), made.secret);
      const result = store.connect(
        workspaceId,
        { id, kind: made.kind, identity: made.identity, options: made.options },
        now(),
      );
      // Another connect of the same thing got there while the secret was
      // kept: one made under a new ID is no one's. A revived one's is the
      // other connect's now, so it stays.
      if ("taken" in result && made.secret !== undefined && !("revives" in plan))
        await secrets.delete(secretName(id)).catch(() => {});
      return result;
    },

    // Keeps a connection's secret anew, as a refreshed token is.
    async rekey(id: Ulid, secret: string): Promise<void> {
      await secrets.set(secretName(id), secret);
    },

    // Signs a live connection in again, with its options: the same ID,
    // number and items.
    async signIn(
      connection: Connection,
      next: { options: Record<string, unknown>; secret: string },
    ): Promise<void> {
      await secrets.set(secretName(connection.id), next.secret);
      store.configure(workspaceId, connection.id, next.options);
    },

    // A connection a flag makes at start, under `pnpm dev`, for fixtures and
    // tests: its kind's first, which follows its flag. A database is one per
    // set of modes, so what a flag names changes only when `.env` does, and
    // then its items follow it, as a kind's did before connections. It keeps
    // no secret: `.env` holds that.
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

    // Disconnects: its secret deleted, a tombstone left, and its items, their
    // change log and the references they made forgotten. Workstreams that
    // hold its items keep them, as items the index no longer has, and
    // threads keep what was said.
    async disconnect(connection: Connection): Promise<void> {
      await secrets.delete(secretName(connection.id));
      store.disconnect(workspaceId, connection.id, now());
      index.forget(workspaceId, connection.prefix, now());
      log("connections: disconnected", { kind: connection.kind, number: connection.number });
    },
  };
}
