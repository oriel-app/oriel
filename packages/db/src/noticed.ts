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
  createdAt: Instant;
};

export const kindOfSignal = (signal: string): SignalKind | null => {
  const kind = signal.slice(0, signal.indexOf(":"));
  return isSignalKind(kind) ? kind : null;
};

export const dismissedDays = 30;

export const maxPins = 4;

export function dismissals(
  db: DatabaseSync,
  workspaceId: Ulid,
  now: Instant,
): (Dismissal & { kind: SignalKind })[] {
  const since = new Date(Date.parse(now) - dismissedDays * 86_400_000).toISOString();
  return db
    .prepare(
      "select signal, fingerprint from noticed_dismissals where workspace_id = ? and at >= ?",
    )
    .all(workspaceId, since)
    .flatMap((row) => {
      const { signal, fingerprint } = row as Record<string, unknown>;
      if (typeof signal !== "string" || typeof fingerprint !== "string") return [];
      const kind = kindOfSignal(signal);
      return kind ? [{ signal, fingerprint, kind }] : [];
    });
}

export function dismiss(
  db: DatabaseSync,
  workspaceId: Ulid,
  dismissal: Dismissal,
  at: Instant,
): void {
  db.prepare(
    `insert into noticed_dismissals (workspace_id, signal, fingerprint, at)
       values (?, ?, ?, ?)
       on conflict (workspace_id, signal, fingerprint) do update set at = excluded.at`,
  ).run(workspaceId, dismissal.signal, dismissal.fingerprint, at);
}

export function pins(db: DatabaseSync, workspaceId: Ulid): Pin[] {
  return db
    .prepare(
      "select id, spec, signal, created_at from pins where workspace_id = ? order by created_at, id",
    )
    .all(workspaceId)
    .flatMap((row): Pin[] => {
      const { id, spec, signal, created_at } = row as Record<string, unknown>;
      const parsed = typeof spec === "string" ? blockSpec(JSON.parse(spec)) : null;
      if (!parsed?.ok || typeof id !== "string" || typeof created_at !== "string") return [];
      return [
        {
          id: id as Ulid,
          spec: parsed.value,
          signal: typeof signal === "string" ? signal : null,
          createdAt: created_at as Instant,
        },
      ];
    });
}

export function addPin(db: DatabaseSync, workspaceId: Ulid, pin: Pin): { refused: string } | null {
  const held = pins(db, workspaceId);
  if (pin.signal && held.some((each) => each.signal === pin.signal))
    return { refused: "That card is pinned already." };
  if (held.length >= maxPins)
    return { refused: `The overview holds ${maxPins} pins already; unpin one first.` };
  db.prepare(
    "insert into pins (id, workspace_id, spec, signal, created_at) values (?, ?, ?, ?, ?)",
  ).run(pin.id, workspaceId, JSON.stringify(pin.spec), pin.signal, pin.createdAt);
  return null;
}

export function removePin(db: DatabaseSync, workspaceId: Ulid, id: Ulid): boolean {
  return (
    db.prepare("delete from pins where workspace_id = ? and id = ?").run(workspaceId, id).changes >
    0
  );
}

// `picks` is the model's output as written: the service checks it against the signals on offer before showing any.
export type StoredPass = { key: string; at: Instant; model: string; picks: unknown };

export function lastPass(db: DatabaseSync, workspaceId: Ulid): StoredPass | null {
  const row = db
    .prepare("select key, at, model, picks from noticed_passes where workspace_id = ?")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row || typeof row.key !== "string" || typeof row.at !== "string") return null;
  if (typeof row.model !== "string" || typeof row.picks !== "string") return null;
  return { key: row.key, at: row.at as Instant, model: row.model, picks: JSON.parse(row.picks) };
}

export function keepPass(db: DatabaseSync, workspaceId: Ulid, pass: StoredPass): void {
  db.prepare(
    `insert into noticed_passes (workspace_id, key, at, model, picks) values (?, ?, ?, ?, ?)
     on conflict (workspace_id) do update set
       key = excluded.key, at = excluded.at, model = excluded.model, picks = excluded.picks`,
  ).run(workspaceId, pass.key, pass.at, pass.model, JSON.stringify(pass.picks));
}
