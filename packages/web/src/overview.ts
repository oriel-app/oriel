// The overview (decision 0027): the window's first view, at `/`. It loads
// whole each time it is entered, and again whenever the workspace changes.
// Its sections show a few rows each; "more" opens the rest in place, or in
// Browse, filtered to that slice. Leaving it marks what it showed as seen.
import type { OverviewSection } from "@oriel/core/overview";
import { type Effect, errorOf, get, post, type Replied, report } from "./http.ts";
import type { Route } from "./route.ts";
import type { OverviewView } from "./view.ts";

export type OverviewModel = {
  view: OverviewView | null;
  // Why the last load failed, while nothing better has loaded since.
  problem: string | null;
  // The sections opened past their first rows, in place.
  opened: readonly OverviewSection[];
};

export type OverviewMsg =
  // A section's "more": in place, or into Browse at `to`.
  { type: "moreOpened"; section: OverviewSection; to: Route | null } | { type: "retryClicked" };

export const loadOverview: Effect = get("/api/overview", { kind: "overview" });

// How many rows a section shows until "more" is asked for.
export const shown = { needsYou: 4, workstreams: 8 } as const;

// Entering the overview loads it fresh, and counts as opening it.
export function initOverview(): [OverviewModel, Effect[]] {
  return [
    { view: null, problem: null, opened: [] },
    [loadOverview, report({ name: "overview.opened" })],
  ];
}

export function updateOverview(model: OverviewModel, msg: OverviewMsg): [OverviewModel, Effect[]] {
  switch (msg.type) {
    case "moreOpened": {
      const told = report({ name: "overview.more-opened", section: msg.section });
      if (msg.to) return [model, [told, { type: "navigate", route: msg.to }]];
      if (model.opened.includes(msg.section)) return [model, [told]];
      return [{ ...model, opened: [...model.opened, msg.section] }, [told]];
    }
    case "retryClicked":
      return [model, [loadOverview]];
  }
}

export function overviewReplied(model: OverviewModel, msg: Replied): OverviewModel {
  if (!msg.ok) return { ...model, problem: errorOf(msg.body) };
  return { ...model, view: msg.body as OverviewView, problem: null };
}

// Leaving marks seen what the overview showed, up to the last change log
// entry it counted: one that committed after it rendered stays unseen. A
// page that never loaded showed nothing.
export function leaving(model: OverviewModel | null): Effect[] {
  const seq = model?.view?.seq;
  return seq === undefined ? [] : [post("/api/overview/leave", { seq }, { kind: "overviewLeft" })];
}
