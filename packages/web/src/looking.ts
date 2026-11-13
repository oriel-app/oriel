// With words typed, the draft keeps its item and a newly opened one is only offered,
// so a typed question never changes subject behind the person's back.

import { type Effect, report } from "./http.ts";

export type LookItem = { id: string; key: string; title: string | null; under: number | null };

export type LookingAt = {
  chips: readonly { item: LookItem; on: boolean; placed?: true }[];
  offered: LookItem | null;
  open: LookItem | null;
};

export type LookingMsg =
  | { type: "lookDropped"; id: string }
  | { type: "lookAddedBack"; id: string }
  | { type: "lookOfferedAdded" }
  | { type: "lookPlaced"; item: LookItem };

export const notLooking: LookingAt = { chips: [], offered: null, open: null };

const drafting = (draft: string) => draft.trim() !== "";

const most = 4;

const same = (a: LookItem | null, b: LookItem | null) =>
  a?.id === b?.id && a?.title === b?.title && a?.under === b?.under;

export function lookedAt(looking: LookingAt, open: LookItem | null, draft: string): LookingAt {
  if (same(looking.open, open)) return looking;
  if (open && looking.open?.id === open.id) {
    const named = (item: LookItem) => (item.id === open.id ? open : item);
    return {
      chips: looking.chips.map((chip) => ({ ...chip, item: named(chip.item) })),
      offered: looking.offered && named(looking.offered),
      open,
    };
  }
  const keeps = drafting(draft) && looking.chips.length > 0;
  if (open === null) {
    if (keeps) return { ...looking, offered: null, open };
    const placed = looking.chips.filter((chip) => chip.placed);
    return placed.length ? { chips: placed, offered: null, open } : notLooking;
  }
  if (!keeps) {
    const placed = looking.chips.filter((chip) => chip.placed);
    if (placed.length >= most || placed.some((chip) => chip.item.id === open.id))
      return { chips: placed, offered: null, open };
    return { chips: [{ item: open, on: true }, ...placed], offered: null, open };
  }
  const held =
    looking.chips.some((chip) => chip.item.id === open.id) || looking.chips.length >= most;
  return { ...looking, offered: held ? null : open, open };
}

export const placeable = (looking: LookingAt, id: string): boolean => {
  const chip = looking.chips.find((chip) => chip.item.id === id);
  return chip ? !chip.on : looking.chips.length < most;
};

export function updateLooking(looking: LookingAt, msg: LookingMsg): LookingAt {
  switch (msg.type) {
    case "lookDropped":
      return {
        ...looking,
        chips: looking.chips.map((chip) =>
          chip.item.id === msg.id ? { ...chip, on: false } : chip,
        ),
      };
    case "lookAddedBack":
      return {
        ...looking,
        chips: looking.chips.map((chip) =>
          chip.item.id === msg.id ? { ...chip, on: true } : chip,
        ),
      };
    case "lookOfferedAdded": {
      const { offered } = looking;
      if (!offered || looking.chips.length >= most) return looking;
      return { ...looking, chips: [...looking.chips, { item: offered, on: true }], offered: null };
    }
    case "lookPlaced": {
      const { item } = msg;
      if (!placeable(looking, item.id)) return looking;
      if (looking.chips.some((chip) => chip.item.id === item.id))
        return {
          ...looking,
          chips: looking.chips.map((chip) =>
            chip.item.id === item.id ? { ...chip, on: true, placed: true } : chip,
          ),
        };
      return {
        ...looking,
        chips: [...looking.chips, { item, on: true, placed: true }],
        offered: looking.offered?.id === item.id ? null : looking.offered,
      };
    }
  }
}

export const lookingReported = (msg: LookingMsg): Effect[] =>
  msg.type === "lookPlaced"
    ? [report({ name: "item.dropped-on-composer", item: msg.item.id })]
    : [];

export const looked = (looking: LookingAt): LookingAt =>
  looking.open
    ? { chips: [{ item: looking.open, on: true }], offered: null, open: looking.open }
    : notLooking;

export function aboutOf(looking: LookingAt): { id: string; under: number | null }[] | undefined {
  const about = looking.chips
    .filter((chip) => chip.on)
    .map(({ item }) => ({ id: item.id, under: item.under }));
  return about.length ? about : undefined;
}
