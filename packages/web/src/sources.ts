// The sources, at the foot of the sidebar: every connected one, each drawn
// the same way from what the server lists, and syncing any of them, or all,
// on demand. A sync that fails keeps what the window had, and says why on
// its source until its next sync works.
import { type Effect, errorOf, get, post, type Replied } from "./http.ts";
import type { SourceView } from "./view.ts";

export type SourcesModel = {
  // Every connected source, as the server has them; null before they load.
  view: SourceView[] | null;
  // The sources syncing now, by kind.
  syncing: readonly string[];
  // Why a source's last sync didn't work, by kind, until one does.
  problems: Readonly<Record<string, string>>;
};

export type SourcesMsg = { type: "syncClicked"; source: string } | { type: "syncAllClicked" };

export const loadSources: Effect = get("/api/sources", { kind: "sources" });

export function initSources(): SourcesModel {
  return { view: null, syncing: [], problems: {} };
}

export function updateSources(model: SourcesModel, msg: SourcesMsg): [SourcesModel, Effect[]] {
  const kinds =
    msg.type === "syncAllClicked"
      ? (model.view ?? []).map((source) => source.kind)
      : model.view?.some((source) => source.kind === msg.source)
        ? [msg.source]
        : [];
  const asked = kinds.filter((kind) => !model.syncing.includes(kind));
  if (asked.length === 0) return [model, []];
  const problems = Object.fromEntries(
    Object.entries(model.problems).filter(([kind]) => !asked.includes(kind)),
  );
  return [
    { ...model, syncing: [...model.syncing, ...asked], problems },
    asked.map((kind) => post(`/api/${kind}/sync`, {}, { kind: "sourceSynced", source: kind })),
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
      model: msg.ok ? { ...model, view: (msg.body as { sources: SourceView[] }).sources } : model,
      synced: false,
    };
  if (tag.kind !== "sourceSynced") return { model, synced: false };
  const syncing = model.syncing.filter((kind) => kind !== tag.source);
  if (!msg.ok)
    return {
      model: {
        ...model,
        syncing,
        problems: { ...model.problems, [tag.source]: errorOf(msg.body) },
      },
      synced: false,
    };
  return { model: { ...model, syncing }, synced: true };
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
  const times = view.map((source) => source.syncedAt);
  return {
    count: view.length,
    // A source never synced makes the whole line "not synced yet".
    syncedAt: times.some((at) => at === null) ? null : (times.toSorted()[0] ?? null),
    syncing: model.syncing.length > 0,
    problem: view.some((source) => model.problems[source.kind] !== undefined),
  };
}

// How long ago `instant` was, at `now`: "just now", "5m ago", "3h ago",
// "9d ago".
export function ago(instant: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(instant)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / (60 * 24))}d ago`;
}
