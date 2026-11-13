import { type Effect, get, type Replied, report } from "./http.ts";
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";
import type { SearchResultView, SearchView } from "./view.ts";

export type SearchModel = {
  query: string;
  // A reply to an earlier query, or a pause that ended before the last keystroke, is dropped.
  request: number;
  results: readonly SearchResultView[] | null;
  failed: boolean;
  active: number;
};

export type SearchMsg =
  | { type: "typed"; text: string }
  | { type: "paused"; request: number }
  | { type: "moved"; by: 1 | -1 }
  | { type: "entered" }
  | { type: "picked"; index: number }
  | { type: "cleared" };

export const pauseMs = 150;

export const initSearch = (): SearchModel => ({
  query: "",
  request: 0,
  results: null,
  failed: false,
  active: 0,
});

const send = (msg: SearchMsg): Msg => ({ type: "search", msg });

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

// Counted by the query's length and what it found, never by its text.
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
