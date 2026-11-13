import type { ChangeSetState } from "@oriel/core/oriel-reads";
import { connectorOf, type Connectors } from "./connectors.ts";
import type { ChipView, ThreadStateId } from "./view.ts";

export const stateNames: Record<ThreadStateId, string> = {
  working: "Working",
  done: "Done",
  "handed-off": "Handed off",
  dropped: "Dropped",
};

export const changeSetStateNames: Record<ChangeSetState, string> = {
  pending: "waiting",
  approved: "approved",
  applied: "applied",
  rejected: "rejected",
  reverted: "reverted",
};

export function keyLabel(item: { id: string; key: string }, connectors: Connectors): string {
  return connectorOf(connectors, item.id)?.keysReadAs ?? item.key;
}

const readsAs = (chip: Extract<ChipView, { kind: "item" }>, connectors: Connectors) =>
  connectors[chip.source]?.keysReadAs ?? null;

export const chipKey = (chip: ChipView, connectors: Connectors): string | null =>
  chip.kind === "item" && readsAs(chip, connectors) === null ? chip.key : null;

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

export function chipLabel(chip: ChipView, connectors: Connectors): string {
  const lead =
    chip.kind === "item" ? (readsAs(chip, connectors) ?? chip.key) : kindNames[chip.kind];
  const state = chipStateName(chip);
  return `${lead}: ${chip.name}${state ? `, ${state.toLowerCase()}` : ""}`;
}

// Counted in code points, not UTF-16 units, so an emoji is never cut in half.
const nameMax = 44;

export function chipName(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= nameMax) return name;
  const head = characters.slice(0, nameMax).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > nameMax / 2 ? head.slice(0, space) : head).replace(/[\s,:;.–-]+$/u, "")}…`;
}
