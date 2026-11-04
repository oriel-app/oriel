// A chip (decision 0032): an item, a thread, a change set or a workstream an
// agent names in its answer as `[[id]]`, drawn in the line as an icon for its
// kind, its key, its name and where it stands, from what the server resolved
// (`ChipView`), never from the agent's words. A rows block draws its items
// the same way, so an item looks the same in a sentence and in a block.
import type { ChangeSetState } from "@oriel/core/oriel-reads";
import { connectorOf, type Connectors } from "./connectors.ts";
import type { ChipView, ThreadStateId } from "./view.ts";

// Where a thread stands, as a person says it: on its chip, its page and in
// the sidebar.
export const stateNames: Record<ThreadStateId, string> = {
  working: "Working",
  done: "Done",
  "handed-off": "Handed off",
  dropped: "Dropped",
};

// Where a change set stands, as a person says it after "Change set": among
// the sidebar's search results, and, as a sentence starts, on its chip.
export const changeSetStateNames: Record<ChangeSetState, string> = {
  pending: "waiting",
  approved: "approved",
  applied: "applied",
  rejected: "rejected",
  reverted: "reverted",
};

// What a person reads for an item's key: what its connector says its keys
// read as, where a key means nothing to anyone, such as a hash; its title
// says which.
export function keyLabel(item: { id: string; key: string }, connectors: Connectors): string {
  return connectorOf(connectors, item.id)?.keysReadAs ?? item.key;
}

// What an item chip's key reads as, by its source's kind, if not the key.
const readsAs = (chip: Extract<ChipView, { kind: "item" }>, connectors: Connectors) =>
  connectors[chip.source]?.keysReadAs ?? null;

// The key beside a chip's icon: none for an item whose key reads as what it
// is, which its icon says.
export const chipKey = (chip: ChipView, connectors: Connectors): string | null =>
  chip.kind === "item" && readsAs(chip, connectors) === null ? chip.key : null;

// Where it stands, for its colour: an item's status category, a thread's or
// a change set's state, or a workstream open or done.
export function chipState(chip: ChipView): string | undefined {
  switch (chip.kind) {
    case "item":
      return chip.state?.category;
    case "thread":
    case "change-set":
      return chip.state;
    case "workstream":
      return chip.done ? "done" : "open";
  }
}

const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

// Where it stands, as a sentence starts; null for an item whose source
// tracks no state.
export function chipStateName(chip: ChipView): string | null {
  switch (chip.kind) {
    case "item":
      return chip.state?.name ?? null;
    case "thread":
      return chip.state === "needs-you" ? "Needs you" : stateNames[chip.state];
    case "change-set":
      return capital(changeSetStateNames[chip.state]);
    case "workstream":
      return chip.done ? "Done" : "Open";
  }
}

const kindNames: Record<Exclude<ChipView["kind"], "item">, string> = {
  thread: "Thread",
  "change-set": "Change set",
  workstream: "Workstream",
};

// What a chip says in full, to a screen reader and on hover: its kind or
// key, its whole name, and where it stands.
export function chipLabel(chip: ChipView, connectors: Connectors): string {
  const lead =
    chip.kind === "item" ? (readsAs(chip, connectors) ?? chip.key) : kindNames[chip.kind];
  const state = chipStateName(chip);
  return `${lead}: ${chip.name}${state ? `, ${state.toLowerCase()}` : ""}`;
}

// How long a name runs inside a sentence before it is cut, at a word, with
// the whole name in its label. Counted in characters, so an emoji is never
// cut in half.
const nameMax = 44;

export function chipName(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= nameMax) return name;
  const head = characters.slice(0, nameMax).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > nameMax / 2 ? head.slice(0, space) : head).replace(/[\s,:;.–-]+$/u, "")}…`;
}
