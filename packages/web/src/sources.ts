// The sources, at the foot of the sidebar: every open connection, each drawn
// the same way from what the server lists, and syncing any of them, or all,
// on demand. A sync that fails keeps what the window had, and says why on
// its connection until its next sync works.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { ConnectionsView, ConnectionView } from "./view.ts";

export type SourcesModel = {
  // Every open connection, as the server has them; null before they load.
  view: ConnectionView[] | null;
  // The connections syncing now, by ID.
  syncing: readonly string[];
  // Why a connection's last sync didn't work, by ID, until one does.
  problems: Readonly<Record<string, string>>;
};

export type SourcesMsg = { type: "syncClicked"; connection: string } | { type: "syncAllClicked" };

export const loadSources: Effect = get("/api/connections", { kind: "sources" });

export function initSources(): SourcesModel {
  return { view: null, syncing: [], problems: {} };
}

export function updateSources(model: SourcesModel, msg: SourcesMsg): [SourcesModel, Effect[]] {
  const ids =
    msg.type === "syncAllClicked"
      ? (model.view ?? []).map((connection) => connection.id)
      : model.view?.some((connection) => connection.id === msg.connection)
        ? [msg.connection]
        : [];
  const asked = ids.filter((id) => !model.syncing.includes(id));
  if (asked.length === 0) return [model, []];
  const problems = Object.fromEntries(
    Object.entries(model.problems).filter(([id]) => !asked.includes(id)),
  );
  return [
    { ...model, syncing: [...model.syncing, ...asked], problems },
    asked.map((id) =>
      post(`/api/connections/${id}/sync`, {}, { kind: "sourceSynced", connection: id }),
    ),
  ];
}

// A reply about the sources. `synced` says a source's index changed, so
// what's on screen, and the list itself, should load again.
export function sourcesReplied(
  model: SourcesModel,
  msg: Replied,
): { model: SourcesModel; synced: boolean } {
  const { tag } = msg;
  if (tag.kind === "sources")
    return {
      model: msg.ok
        ? {
            ...model,
            view: (msg.body as ConnectionsView).connections.filter(
              (connection) => connection.state === "open",
            ),
          }
        : model,
      synced: false,
    };
  if (tag.kind !== "sourceSynced") return { model, synced: false };
  const syncing = model.syncing.filter((id) => id !== tag.connection);
  if (!msg.ok)
    return {
      model: {
        ...model,
        syncing,
        problems: { ...model.problems, [tag.connection]: errorOf(msg.body) },
      },
      synced: false,
    };
  return { model: { ...model, syncing }, synced: true };
}

// What a source's last sync changed, as its row says it: only the counts
// that aren't zero, such as "3 new · 1 changed". Null when it changed
// nothing.
export function syncChanges(counts: ConnectionView["lastSync"]): string | null {
  const said = [
    counts.new && `${counts.new} new`,
    counts.changed && `${counts.changed} changed`,
    counts.removed && `${counts.removed} removed`,
  ].filter(Boolean);
  return said.length ? said.join(" · ") : null;
}

// The sources folded to one line: how many, when the longest ago of them
// last synced, and whether any is syncing or has a problem.
export function sourcesLine(model: SourcesModel): {
  count: number;
  syncedAt: string | null;
  syncing: boolean;
  problem: boolean;
} {
  const view = model.view ?? [];
  const times = view.map((connection) => connection.syncedAt);
  return {
    count: view.length,
    // A source never synced makes the whole line "not synced yet".
    syncedAt: times.some((at) => at === null) ? null : (times.toSorted()[0] ?? null),
    syncing: model.syncing.length > 0,
    problem: view.some((connection) => model.problems[connection.id] !== undefined),
  };
}
