// The sidebar's search over the workspace's threads (OA-110): what the user
// typed, what the server found for it, and which result the arrow keys are
// on. It asks the server's one search, the one the agent's thread.find()
// runs, once typing pauses; picking a result opens its thread, at the change
// set when one matched.
import { type Effect, get, type Replied, report } from "./http.ts";
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";
import type { SearchResultView, SearchView } from "./view.ts";

export type SearchModel = {
  query: string;
  // The latest query asked about. A reply to an earlier one, or a pause
  // that ended before the last keystroke, is dropped.
  request: number;
  // What the server found for the query, or null while it hasn't answered.
  results: readonly SearchResultView[] | null;
  failed: boolean;
  // The result Enter opens, from 0.
  active: number;
};

export type SearchMsg =
  | { type: "typed"; text: string }
  // Typing paused after the query `request` names.
  | { type: "paused"; request: number }
  | { type: "moved"; by: 1 | -1 }
  // Enter, on the active result.
  | { type: "entered" }
  // A result clicked, by its place in the list.
  | { type: "picked"; index: number }
  // Escape, or the field emptied.
  | { type: "cleared" };

// How long typing pauses before the server is asked.
export const pauseMs = 150;

export const initSearch = (): SearchModel => ({
  query: "",
  request: 0,
  results: null,
  failed: false,
  active: 0,
});

const send = (msg: SearchMsg): Msg => ({ type: "search", msg });

// Where a result opens: its thread, at the change set that matched.
export function resultRoute(result: SearchResultView): Route {
  return result.changeSet
    ? { page: "thread", id: result.thread.id, changeSet: result.changeSet.id }
    : { page: "thread", id: result.thread.id };
}

function open(model: SearchModel, index: number): [SearchModel, Effect[]] {
  const result = model.results?.[index];
  if (!result) return [model, []];
  return [
    { ...initSearch(), request: model.request + 1 },
    [
      { type: "navigate", route: resultRoute(result) },
      report({
        name: "threads.search-opened",
        opened: result.changeSet ? "change-set" : "thread",
        rank: index + 1,
      }),
    ],
  ];
}

export function updateSearch(model: SearchModel, msg: SearchMsg): [SearchModel, Effect[]] {
  switch (msg.type) {
    case "typed": {
      const request = model.request + 1;
      if (msg.text.trim() === "") return [{ ...initSearch(), query: msg.text, request }, []];
      return [
        { ...model, query: msg.text, request },
        [{ type: "after", ms: pauseMs, msg: send({ type: "paused", request }) }],
      ];
    }
    case "paused":
      if (msg.request !== model.request) return [model, []];
      return [
        model,
        [
          get(`/api/search?${new URLSearchParams({ q: model.query.trim() })}`, {
            kind: "search",
            request: msg.request,
          }),
        ],
      ];
    case "moved": {
      const count = model.results?.length ?? 0;
      if (count === 0) return [model, []];
      return [{ ...model, active: Math.min(Math.max(model.active + msg.by, 0), count - 1) }, []];
    }
    case "entered":
      return open(model, model.active);
    case "picked":
      return open(model, msg.index);
    case "cleared":
      return [{ ...initSearch(), request: model.request + 1 }, []];
  }
}

// The server answered: the results replace what showed, and the search is
// counted by how long the query was and what it found, never by its text.
export function searchReplied(model: SearchModel, msg: Replied): [SearchModel, Effect[]] {
  const { tag } = msg;
  if (tag.kind !== "search" || tag.request !== model.request) return [model, []];
  if (!msg.ok) return [{ ...model, failed: true }, []];
  const { results } = msg.body as SearchView;
  return [
    { ...model, results, failed: false, active: 0 },
    [
      report({
        name: "threads.searched",
        queryLength: [...model.query.trim()].length,
        results: results.length,
      }),
    ],
  ];
}
