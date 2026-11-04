// The overview (decision 0027): the window's first view, at `/`. It loads
// whole each time it is entered, and again whenever the workspace changes.
// Its sections show a few rows each; "more" opens the rest in place, or in
// Browse, filtered to that slice. Leaving it marks what it showed as seen.
import type { OverviewSection } from "@oriel/core/overview";
import { type Effect, errorOf, get, post, type Replied, report, undoing } from "./http.ts";
import type { SignalKind } from "@oriel/core/noticed";
import type { Msg } from "./root.ts";
import type { Route } from "./route.ts";
import { type Held, type Hold, hold, notHeld, restart, runsOut } from "./undos.ts";
import type {
  GroupingId,
  NoticedCardView,
  NoticedView,
  OverviewView,
  Undoable,
  WorkstreamSummary,
} from "./view.ts";
import type { Question } from "./window-chat.ts";

export type OverviewModel = {
  view: OverviewView | null;
  // Why the last load failed, while nothing better has loaded since.
  problem: string | null;
  // The sections opened past their first rows, in place.
  opened: readonly OverviewSection[];
  // Workstreams made here from a suggested cluster, each with its Undo, by
  // the cluster's key, until they run out; `undoing` once its Undo is sent.
  made: readonly Made[];
  // The cluster a Make a workstream is on its way for.
  making: string | null;
  // What last went wrong making or undoing one.
  failed: string | null;
  held: Held;
  countdown: number;
  // Noticed's strip and the pins (decision 0052), loaded
  // beside the overview; the card or pin an action is on its way for, and
  // what last went wrong with one.
  noticed: NoticedView | null;
  noticing: string | null;
  noticedProblem: string | null;
};

export type Made = {
  key: string;
  workstream: Undoable<WorkstreamSummary>;
  undoing: boolean;
};

export type OverviewMsg =
  // A section's "more": in place, or into Browse at `to`.
  | { type: "moreOpened"; section: OverviewSection; to: Route | null }
  | { type: "retryClicked" }
  // Make a workstream, on a cluster Not in a workstream yet suggests.
  | { type: "makeClicked"; grouping: GroupingId; key: string }
  | { type: "undoClicked"; key: string }
  | { type: "undoHeld"; by: Hold; held: boolean }
  | { type: "undoExpired"; countdown: number }
  | { type: "failedDismissed" }
  // Noticed: a look again while a pass runs, and a card's or a pin's
  // actions.
  | { type: "noticedPoll" }
  | { type: "dismissClicked"; signal: string }
  | { type: "pinClicked"; signal: string }
  | { type: "unpinClicked"; pin: string };

export const loadOverview: Effect = get("/api/overview", { kind: "overview" });
export const loadNoticed: Effect = get("/api/noticed", { kind: "noticed" });

// How long the strip waits to look again while a pass runs.
export const noticedPollMs = 2000;

// How many rows a section shows until "more" is asked for.
// `quiet`: how many workstreams gone quiet show past the first few.
export const shown = { workstreams: 8, quiet: 4 } as const;

// Entering the overview loads it fresh, and counts as opening it.
export function initOverview(): [OverviewModel, Effect[]] {
  return [
    {
      view: null,
      problem: null,
      opened: [],
      made: [],
      making: null,
      failed: null,
      held: notHeld,
      countdown: 0,
      noticed: null,
      noticing: null,
      noticedProblem: null,
    },
    [loadOverview, loadNoticed, report({ name: "overview.opened" })],
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
    case "makeClicked": {
      if (model.making !== null) return [model, []];
      return [
        { ...model, making: msg.key, failed: null },
        [
          post(
            "/api/workstreams",
            { kind: "cluster", grouping: msg.grouping, cluster: msg.key },
            { kind: "overviewMade", key: msg.key, grouping: msg.grouping },
          ),
        ],
      ];
    }
    case "undoClicked": {
      const made = model.made.find((each) => each.key === msg.key);
      if (!made?.workstream.undo || made.undoing) return [model, []];
      const [released, restarts] = hold(model, "focus", false, again);
      return [
        {
          ...released,
          made: model.made.map((each) => (each === made ? { ...each, undoing: true } : each)),
          failed: null,
        },
        [undoing(made.workstream.undo, { kind: "overviewUnmade", key: msg.key }), ...restarts],
      ];
    }
    case "undoHeld":
      return hold(model, msg.by, msg.held, again);
    case "undoExpired":
      if (!runsOut(model, msg.countdown)) return [model, []];
      return [{ ...model, made: model.made.filter((each) => each.undoing) }, []];
    case "failedDismissed":
      return [{ ...model, failed: null }, []];
    case "noticedPoll":
      return [model, [loadNoticed]];
    case "dismissClicked":
    case "pinClicked": {
      if (model.noticing !== null) return [model, []];
      const action = msg.type === "pinClicked" ? "pin" : "dismiss";
      return [
        { ...model, noticing: msg.signal, noticedProblem: null },
        [post(`/api/noticed/${action}`, { signal: msg.signal }, { kind: "noticedChanged" })],
      ];
    }
    case "unpinClicked":
      if (model.noticing !== null) return [model, []];
      return [
        { ...model, noticing: msg.pin, noticedProblem: null },
        [post(`/api/pins/${msg.pin}/remove`, {}, { kind: "noticedChanged" })],
      ];
  }
}

// The strip loaded: while a pass runs, it looks again shortly. An action
// answered: the strip loads again, or says what went wrong.
export function noticedReplied(model: OverviewModel, msg: Replied): [OverviewModel, Effect[]] {
  if (msg.tag.kind === "noticedChanged") {
    const done = { ...model, noticing: null };
    if (!msg.ok) return [{ ...done, noticedProblem: errorOf(msg.body) }, []];
    return [done, [loadNoticed]];
  }
  if (!msg.ok) return [model, []];
  const noticed = msg.body as NoticedView;
  const poll: Effect[] =
    noticed.status === "running"
      ? [
          {
            type: "after",
            ms: noticedPollMs,
            msg: { type: "overview", msg: { type: "noticedPoll" } },
          },
        ]
      : [];
  return [{ ...model, noticed }, poll];
}

const expired = (countdown: number): Msg => ({
  type: "overview",
  msg: { type: "undoExpired", countdown },
});

// Once neither pointer nor keyboard holds the notes, they get their full
// time again.
const again = (model: OverviewModel): [OverviewModel, Effect[]] =>
  model.made.length === 0 ? [model, []] : restart(model, expired);

// Make a workstream answered: the workstream shows with its Undo, which
// starts to run out, and the overview loads again, its counts with it. Its
// Undo answered: the note goes, and the overview loads again.
export function madeReplied(model: OverviewModel, msg: Replied): [OverviewModel, Effect[]] {
  const { tag } = msg;
  if (tag.kind === "overviewMade") {
    if (!msg.ok) return [{ ...model, making: null, failed: errorOf(msg.body) }, []];
    const workstream = msg.body as Undoable<WorkstreamSummary>;
    const [counted, expiry] = restart(
      {
        ...model,
        making: null,
        made: [
          ...model.made.filter((each) => each.key !== tag.key),
          { key: tag.key, workstream, undoing: false },
        ],
      },
      expired,
    );
    return [
      counted,
      [
        loadOverview,
        report({
          name: "overview.suggestion-made",
          workstreamId: workstream.id,
          grouping: tag.grouping,
        }),
        ...expiry,
      ],
    ];
  }
  if (tag.kind !== "overviewUnmade") return [model, []];
  if (!msg.ok)
    return [
      {
        ...model,
        made: model.made.map((each) => (each.key === tag.key ? { ...each, undoing: false } : each)),
        failed: errorOf(msg.body),
      },
      [],
    ];
  return [{ ...model, made: model.made.filter((each) => each.key !== tag.key) }, [loadOverview]];
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

// What Ask about this sends: fixed words and a workstream's or an item's
// ID, never a name, a title or a person's ID, which may be synced text
// (decision 0030).
export function askAbout(card: NoticedCardView): Question {
  const { subject } = card;
  const what: Record<SignalKind, string> = {
    stalled: `that the workstream ${subject.id} stalled`,
    drift: `estimates rising in the workstream ${subject.id}`,
    // A person's ID may be synced text, as a spreadsheet's cell is: never in
    // the person's own words. The agent finds them on the overview.
    overloaded: "a person with a lot in progress, twice the median or more",
    contradicted: `chat naming ${subject.id} after it was marked done`,
    scope: `that the epic ${subject.id} grew`,
  };
  return {
    kind: "noticed",
    label: "Ask about this",
    text: `Oriel noticed ${what[card.kind]}. What's behind it, and what should I do?`,
  };
}
