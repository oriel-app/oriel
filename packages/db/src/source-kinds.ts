import type { DatabaseSync } from "node:sqlite";
import type { Instant, Ulid } from "@oriel/core";

export type KindChoice = {
  state: "on" | "off";
  server: string | null;
  by: "person" | "agent";
};

export type FoundKind = { kind: string; server: string };

export type FoundChange = { appeared: FoundKind[]; gone: FoundKind[] };

export type Finds = { agent: string; found: FoundKind[]; card: FoundChange | null };

export type StandInMove = {
  standIn: string;
  into: string;
  threadId: Ulid;
  changeSetId: Ulid;
  items: Readonly<Record<string, string>>;
  movedAt: Instant | null;
};

export type SourceKindStore = ReturnType<typeof sourceKindStore>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const foundKinds = (value: unknown): FoundKind[] =>
  (Array.isArray(value) ? value : []).flatMap((each) =>
    isObject(each) && typeof each.kind === "string" && typeof each.server === "string"
      ? [{ kind: each.kind, server: each.server }]
      : [],
  );

export function sourceKindStore(db: DatabaseSync) {
  const selectChoices = db.prepare(
    "select kind, state, server, by from source_kinds where workspace_id = ? order by kind",
  );
  const upsert = db.prepare(`
    insert into source_kinds (workspace_id, kind, state, server, by, at) values (?, ?, ?, ?, ?, ?)
    on conflict (workspace_id, kind) do update set
      state = excluded.state, server = excluded.server, by = excluded.by, at = excluded.at`);
  const remove = db.prepare("delete from source_kinds where workspace_id = ? and kind = ?");
  const selectFinds = db.prepare(
    "select agent, found, card from source_finds where workspace_id = ?",
  );
  const keep = db.prepare(`
    insert into source_finds (workspace_id, agent, found, card, at) values (?, ?, ?, ?, ?)
    on conflict (workspace_id) do update set
      agent = excluded.agent, found = excluded.found, card = excluded.card, at = excluded.at`);
  const clearCard = db.prepare("update source_finds set card = null where workspace_id = ?");
  const selectMoves = db.prepare(`
    select stand_in, into_kind, thread_id, change_set_id, items, moved_at from stand_in_moves
    where workspace_id = ? order by at`);
  const insertMove = db.prepare(`
    insert into stand_in_moves
      (workspace_id, stand_in, into_kind, thread_id, change_set_id, items, at)
    values (?, ?, ?, ?, ?, ?, ?)`);
  const markMoved = db.prepare(
    "update stand_in_moves set moved_at = ? where workspace_id = ? and change_set_id = ?",
  );
  return {
    moves(workspaceId: Ulid): StandInMove[] {
      return selectMoves.all(workspaceId).map((row) => {
        const each = row as Record<string, string | null>;
        const items = JSON.parse(each.items ?? "{}") as unknown;
        return {
          standIn: String(each.stand_in),
          into: String(each.into_kind),
          threadId: String(each.thread_id) as Ulid,
          changeSetId: String(each.change_set_id) as Ulid,
          items: isObject(items)
            ? Object.fromEntries(
                Object.entries(items).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              )
            : {},
          movedAt: (each.moved_at ?? null) as Instant | null,
        };
      });
    },
    offerMove(workspaceId: Ulid, move: Omit<StandInMove, "movedAt">, at: Instant): void {
      insertMove.run(
        workspaceId,
        move.standIn,
        move.into,
        move.threadId,
        move.changeSetId,
        JSON.stringify(move.items),
        at,
      );
    },
    moved(workspaceId: Ulid, changeSetId: Ulid, at: Instant | null): void {
      markMoved.run(at, workspaceId, changeSetId);
    },
    choices(workspaceId: Ulid): Map<string, KindChoice> {
      return new Map(
        selectChoices.all(workspaceId).flatMap((row) => {
          const { kind, state, server, by } = row as Record<string, unknown>;
          if (typeof kind !== "string" || (state !== "on" && state !== "off")) return [];
          return [
            [
              kind,
              {
                state,
                server: typeof server === "string" ? server : null,
                by: by === "agent" ? "agent" : "person",
              } satisfies KindChoice,
            ],
          ];
        }),
      );
    },
    choose(workspaceId: Ulid, kind: string, choice: KindChoice | null, at: Instant): void {
      if (choice === null) remove.run(workspaceId, kind);
      else upsert.run(workspaceId, kind, choice.state, choice.server, choice.by, at);
    },
    finds(workspaceId: Ulid): Finds | null {
      const row = selectFinds.get(workspaceId) as Record<string, unknown> | undefined;
      if (!row || typeof row.agent !== "string" || typeof row.found !== "string") return null;
      const card = typeof row.card === "string" ? (JSON.parse(row.card) as unknown) : null;
      return {
        agent: row.agent,
        found: foundKinds(JSON.parse(row.found)),
        card: isObject(card)
          ? { appeared: foundKinds(card.appeared), gone: foundKinds(card.gone) }
          : null,
      };
    },
    keepFinds(workspaceId: Ulid, finds: Finds, at: Instant): void {
      keep.run(
        workspaceId,
        finds.agent,
        JSON.stringify(finds.found),
        finds.card === null ? null : JSON.stringify(finds.card),
        at,
      );
    },
    dismiss(workspaceId: Ulid): void {
      clearCard.run(workspaceId);
    },
  };
}
