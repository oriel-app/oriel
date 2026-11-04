// Noticed's store (docs/decisions/draft-noticed.md): the signals a person
// dismissed, by fingerprint, and their pins, each a block's spec rerun on
// every look (decision 0030).
import type { DatabaseSync } from "node:sqlite";
import {
  blockSpec,
  type BlockSpec,
  type Dismissal,
  type Instant,
  isSignalKind,
  type SignalKind,
  type Ulid,
} from "@oriel/core";

export type Pin = {
  id: Ulid;
  spec: BlockSpec;
  signal: string | null;
  kind: SignalKind | null;
  createdAt: Instant;
};

// At most this many pins (decision 0030).
export const maxPins = 4;

export function dismissals(
  db: DatabaseSync,
  workspaceId: Ulid,
): (Dismissal & { kind: SignalKind })[] {
  return db
    .prepare("select signal, fingerprint, kind from noticed_dismissals where workspace_id = ?")
    .all(workspaceId)
    .flatMap((row) => {
      const { signal, fingerprint, kind } = row as Record<string, unknown>;
      return typeof signal === "string" &&
        typeof fingerprint === "string" &&
        typeof kind === "string" &&
        isSignalKind(kind)
        ? [{ signal, fingerprint, kind }]
        : [];
    });
}

export function dismiss(
  db: DatabaseSync,
  workspaceId: Ulid,
  dismissal: Dismissal & { kind: SignalKind },
  at: Instant,
): void {
  db.prepare(
    `insert into noticed_dismissals (workspace_id, signal, fingerprint, kind, at)
       values (?, ?, ?, ?, ?) on conflict do nothing`,
  ).run(workspaceId, dismissal.signal, dismissal.fingerprint, dismissal.kind, at);
}

export function pins(db: DatabaseSync, workspaceId: Ulid): Pin[] {
  return db
    .prepare(
      "select id, spec, signal, kind, created_at from pins where workspace_id = ? order by created_at, id",
    )
    .all(workspaceId)
    .flatMap((row): Pin[] => {
      const { id, spec, signal, kind, created_at } = row as Record<string, unknown>;
      const parsed = typeof spec === "string" ? blockSpec(JSON.parse(spec)) : null;
      if (!parsed?.ok || typeof id !== "string" || typeof created_at !== "string") return [];
      return [
        {
          id: id as Ulid,
          spec: parsed.value,
          signal: typeof signal === "string" ? signal : null,
          kind: typeof kind === "string" && isSignalKind(kind) ? kind : null,
          createdAt: created_at as Instant,
        },
      ];
    });
}

// Adds a pin, or says why not: a fifth is refused, naming the four.
export function addPin(db: DatabaseSync, workspaceId: Ulid, pin: Pin): { refused: string } | null {
  const held = pins(db, workspaceId);
  if (held.length >= maxPins)
    return { refused: `The overview holds ${maxPins} pins already; unpin one first.` };
  db.prepare(
    "insert into pins (id, workspace_id, spec, signal, kind, created_at) values (?, ?, ?, ?, ?, ?)",
  ).run(pin.id, workspaceId, JSON.stringify(pin.spec), pin.signal, pin.kind, pin.createdAt);
  return null;
}

export function removePin(db: DatabaseSync, workspaceId: Ulid, id: Ulid): boolean {
  return (
    db.prepare("delete from pins where workspace_id = ? and id = ?").run(workspaceId, id).changes >
    0
  );
}
