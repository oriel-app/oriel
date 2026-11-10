// What a person's message is about (decision 0062): the items open beside
// the composer when they sent it, offered there as "Looking at". Each is
// kept by ID, never by its title; marked `outside` when it wasn't in the
// thread's region as the message was sent, so it is read-only, as the
// escape hatch's results are (SPEC §6); and with `under`, the chat entry it
// was opened from, if it was opened from one. Looking adds nothing to the
// workstream: that is a cite's (OA-137).
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

// A message is about one item, or two when the person added the one they
// opened while typing; a few more leave room without letting a client
// send a list.
export const maxAbout = 4;

const itemId = refine(string, isItemId, "expected an item ID", { type: "ItemId" });
const under = nullable(
  refine(number, (n) => Number.isSafeInteger(n) && n > 0, "expected a chat entry's place"),
);
const capped = <T>(list: T[]) => list.length > 0 && list.length <= maxAbout;

// What the window sends: the items and where each was opened. Oriel marks
// which are outside the region itself, as it stores the message.
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
