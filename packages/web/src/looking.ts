// What a composer's next message is about (decision 0062): the item open
// beside it, offered as "Looking at". × leaves it out ("Not sending"), and
// Add back puts it in again. With the field empty, opening another item
// swaps it; with words typed, the draft keeps its item and the new one is
// offered dashed, which + adds, so a typed question never changes subject
// behind the person's back. Closing the item takes it only if nothing is
// typed. Sent, the message keeps its items, by ID; looking adds nothing to
// the workstream.

// An item as the composer names it: its key, and its title once the panel
// has read it. `under`: the chat entry it was opened from, in this thread.
export type LookItem = { id: string; key: string; title: string | null; under: number | null };

export type LookingAt = {
  // What the next message is about, in order; `on` false: Not sending.
  chips: readonly { item: LookItem; on: boolean }[];
  // The item open beside a draft that keeps its own, offered dashed.
  offered: LookItem | null;
  // The item open beside the composer, as it last saw it.
  open: LookItem | null;
};

export type LookingMsg =
  | { type: "lookDropped"; id: string }
  | { type: "lookAddedBack"; id: string }
  | { type: "lookOfferedAdded" };

export const notLooking: LookingAt = { chips: [], offered: null, open: null };

const drafting = (draft: string) => draft.trim() !== "";

const same = (a: LookItem | null, b: LookItem | null) =>
  a?.id === b?.id && a?.title === b?.title && a?.under === b?.under;

// The item open beside the composer now, or none, against what it last saw.
export function lookedAt(looking: LookingAt, open: LookItem | null, draft: string): LookingAt {
  if (same(looking.open, open)) return looking;
  // The same item, read since or opened again from an entry: its name follows.
  if (open && looking.open?.id === open.id) {
    const named = (item: LookItem) => (item.id === open.id ? open : item);
    return {
      chips: looking.chips.map((chip) => ({ ...chip, item: named(chip.item) })),
      offered: looking.offered && named(looking.offered),
      open,
    };
  }
  const keeps = drafting(draft) && looking.chips.length > 0;
  if (open === null) return keeps ? { ...looking, offered: null, open } : notLooking;
  if (!keeps) return { chips: [{ item: open, on: true }], offered: null, open };
  const held = looking.chips.some((chip) => chip.item.id === open.id);
  return { ...looking, offered: held ? null : open, open };
}

export function updateLooking(looking: LookingAt, msg: LookingMsg): LookingAt {
  switch (msg.type) {
    // The first stays, dashed, so the person sees what isn't going; one
    // added beside it goes.
    case "lookDropped":
      return {
        ...looking,
        chips: looking.chips.flatMap((chip, i) =>
          chip.item.id !== msg.id ? [chip] : i === 0 ? [{ ...chip, on: false }] : [],
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
      if (!offered) return looking;
      return { ...looking, chips: [...looking.chips, { item: offered, on: true }], offered: null };
    }
  }
}

// Once a message is sent, the composer offers the item still open.
export const looked = (looking: LookingAt): LookingAt =>
  looking.open
    ? { chips: [{ item: looking.open, on: true }], offered: null, open: looking.open }
    : notLooking;

// What a message sent now is about, as the server takes it; none when empty.
export function aboutOf(looking: LookingAt): { id: string; under: number | null }[] | undefined {
  const about = looking.chips
    .filter((chip) => chip.on)
    .map(({ item }) => ({ id: item.id, under: item.under }));
  return about.length ? about : undefined;
}
