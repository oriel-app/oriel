// Which kinds are on (decision 0059): the person's choice per kind, with the
// source server it came through, and what the last look for the person's
// servers found that Oriel knows, with the overview's card of what changed.
// See migrations/0032_source_kinds.sql.
import type { DatabaseSync } from "node:sqlite";
import type { Instant, Ulid } from "@oriel/core";

export type KindChoice = {
  state: "on" | "off";
  server: string | null;
  by: "person" | "agent";
};

// A known server the agent listed: the kind it serves and its name there.
export type FoundKind = { kind: string; server: string };

// What changed since the look before: the servers that appeared and those
// that went.
export type FoundChange = { appeared: FoundKind[]; gone: FoundKind[] };

export type Finds = { agent: string; found: FoundKind[]; card: FoundChange | null };

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
  return {
    // Each kind a person or the agent chose for, by kind.
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
    // Keeps a choice, or with null forgets it, as an Undo back to no choice
    // does.
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
    // The card's change, dismissed: it shows again only for a new one.
    dismiss(workspaceId: Ulid): void {
      clearCard.run(workspaceId);
    },
  };
}
