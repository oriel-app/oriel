// A chip: something in Oriel named compactly wherever it is shown, as an
// icon for its kind, its name and where it stands. One piece of the window's
// visual language, styled by its own tokens in window.css: a reply's link to
// a thread or a change set shows as one, and more kinds join as more places
// name things this way.
import type { ChangeSetState } from "@oriel/core/oriel-reads";
import { needsYou } from "./nav.ts";
import type { Route } from "./route.ts";
import {
  type ChangeSetSummaryView,
  type ThreadStateId,
  threadStates,
  type ThreadSummaryView,
} from "./view.ts";

export type ChipKind = "thread" | "change-set";

// A thread's state, or, while it works and waits on the user, that it does.
export type ThreadChipState = ThreadStateId | "needs-you";
export type ChipState = ThreadChipState | ChangeSetState;

// `name` and `state` are null where the window doesn't know the thing: a
// thread deleted since, or before the lists have loaded.
export type ChipView = { kind: ChipKind; name: string | null; state: ChipState | null };

export const kindNames: Record<ChipKind, string> = {
  thread: "Thread",
  "change-set": "Change set",
};

// Where a thread stands, as a person says it: on its chip, its page and in
// the sidebar.
export const stateNames: Record<ThreadStateId, string> = {
  working: "Working",
  done: "Done",
  "handed-off": "Handed off",
  dropped: "Dropped",
};

// Where a change set stands, as a person says it after "Change set": on its
// chip and among the sidebar's search results.
export const changeSetStateNames: Record<ChangeSetState, string> = {
  pending: "waiting",
  approved: "approved",
  applied: "applied",
  rejected: "rejected",
  reverted: "reverted",
};

const isThreadState = (state: ChipState): state is ThreadStateId =>
  threadStates.some((each) => each === state);

// What a person reads for where it stands, as a sentence starts.
export function chipStateName(state: ChipState): string {
  if (state === "needs-you") return "Needs you";
  if (isThreadState(state)) return stateNames[state];
  const name = changeSetStateNames[state];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// What a chip says to a screen reader: its kind, its name and where it
// stands. One the window doesn't know says what its label does.
export const chipLabel = (chip: ChipView): string | undefined =>
  chip.name === null
    ? undefined
    : `${kindNames[chip.kind]}: ${chip.name}` +
      (chip.state === null ? "" : `, ${chipStateName(chip.state).toLowerCase()}`);

// What the window knows of its threads and their change sets, from the
// lists the sidebar keeps.
export type Workspace = {
  threads: readonly ThreadSummaryView[] | null;
  changeSets: readonly ChangeSetSummaryView[] | null;
};

const threadName = (thread: ThreadSummaryView) => thread.title ?? "New thread";

// The chip for a link to a thread, or to a change set in one, which goes by
// its thread's name, as the sidebar's search shows it. Any other page has none.
export function linkChip(route: Route, workspace: Workspace): ChipView | null {
  if (route.page !== "thread") return null;
  const thread = workspace.threads?.find((each) => each.id === route.id);
  const name = thread ? threadName(thread) : null;
  if (route.changeSet !== undefined) {
    const set = workspace.changeSets?.find(
      (each) => each.id === route.changeSet && each.thread === route.id,
    );
    return { kind: "change-set", name, state: set?.state ?? null };
  }
  const state = thread ? (needsYou(thread) ? "needs-you" : thread.state) : null;
  return { kind: "thread", name, state };
}
