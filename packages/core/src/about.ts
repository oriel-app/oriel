// Each item is kept by ID, never by its title.
import { isItemId } from "./ids.ts";
import {
  array,
  boolean,
  type Infer,
  nullable,
  number,
  object,
  refine,
  string,
} from "./validate.ts";

// One or two in practice; a few more leave room without letting a client send a list.
export const maxAbout = 4;

const itemId = refine(string, isItemId, "expected an item ID", { type: "ItemId" });
const under = nullable(
  refine(number, (n) => Number.isSafeInteger(n) && n > 0, "expected a chat entry's place"),
);
const capped = <T>(list: T[]) => list.length > 0 && list.length <= maxAbout;

// Oriel marks which are outside the region itself, as it stores the message.
export const lookingAt = refine(
  array(object({ id: itemId, under })),
  (list) => capped(list) && new Set(list.map((each) => each.id)).size === list.length,
  `expected 1 to ${maxAbout} different items`,
);
export type LookingAt = Infer<typeof lookingAt>;

export const aboutValue = refine(
  array(object({ id: itemId, outside: boolean, under })),
  capped,
  `expected 1 to ${maxAbout} items`,
);
export type About = Infer<typeof aboutValue>;
