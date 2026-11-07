// What a change set's card works out from its diff and where it sits on
// screen: what Approve writes, counted; a line's sentence with its item
// named once; whether its actions stick above the composer; and whether
// it shows, for the pill that points to one to review.
import type { DiffView } from "./view.ts";

type Line = DiffView["lines"][number];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A noun's plural, for what a source's create makes ("story", "message").
const pluralOf = (noun: string): string =>
  /[^aeiou]y$/.test(noun)
    ? `${noun.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/.test(noun)
      ? `${noun}es`
      : `${noun}s`;

// "A", "A and B", "A, B and C".
const andList = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// What approving the diff writes, from its own lines, in the head: "5
// changes in <source> · 3 edits, 2 new stories". One kind of change says
// it once: "2 new stories in <source>". Null for a diff with no lines.
export function writes(diff: DiffView): string | null {
  const { lines } = diff;
  if (lines.length === 0) return null;
  const sources = andList([...new Set(lines.map((line) => line.source))]);
  const made = new Map<string, number>();
  for (const line of lines)
    if (line.kind === "create")
      made.set(line.makes ?? "item", (made.get(line.makes ?? "item") ?? 0) + 1);
  const edits = lines.filter((line) => line.kind === "change").length;
  const deletes = lines.filter((line) => line.kind === "delete").length;
  const kinds = [
    ...(edits > 0 ? [count(edits, "edit", "edits")] : []),
    ...[...made].map(([noun, n]) => count(n, `new ${noun}`, `new ${pluralOf(noun)}`)),
    ...(deletes > 0 ? [count(deletes, "deletion", "deletions")] : []),
  ];
  if (kinds.length === 1) return `${kinds[0]} in ${sources}`;
  return `${count(lines.length, "change", "changes")} in ${sources} · ${kinds.join(", ")}`;
}

// The sources a diff writes to, by name, for the line under its actions.
export const sourcesOf = (diff: DiffView): string =>
  andList([...new Set(diff.lines.map((line) => line.source))]);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether a quoted title in a sentence is the item's, whole or cut short,
// its spaces run together as a sentence quotes it.
function titled(quoted: string, title: string | null | undefined): boolean {
  const said = title?.replace(/\s+/g, " ").trim();
  if (!said) return false;
  return quoted === said || (quoted.endsWith("…") && said.startsWith(quoted.slice(0, -1)));
}

// A line's sentence around where it names its item, so the item's chip can
// stand in that place: by its title and key, “Title” (SYN-1), its key
// alone, or, where a source names items by title alone, “Title”. Null where
// the sentence doesn't name it, as a new item's doesn't: then the chip
// follows the sentence.
export function namedOnce(line: Pick<Line, "sentence" | "target">): [string, string] | null {
  const { target, sentence } = line;
  if (!target?.key) return null;
  const k = escaped(target.key);
  const found =
    new RegExp(`“[^”]*” \\(${k}\\)|\\(${k}\\)|(?<![\\w-])${k}(?![\\w-])`).exec(sentence) ??
    [...sentence.matchAll(/“([^”]*)”/g)].find((quote) => titled(quote[1] ?? "", target.title));
  if (!found || found.index === undefined) return null;
  return [sentence.slice(0, found.index), sentence.slice(found.index + found[0].length)];
}

// Watching one line in the window: whether `target` shows above it, and
// if not, whether it's below it. An IntersectionObserver in the window,
// with the line `margin` above the root's bottom edge; a stand-in in a test.
export type Observe<T> = (
  target: T,
  margin: number,
  seen: (above: boolean, below: boolean) => void,
) => () => void;

// Whether a card's actions are stuck above the composer: some of the card
// shows above it, room for the bar besides, while the card's foot, where
// the bar belongs, is under it or further down. `hidden`: how much of the
// root's foot the composer covers. Says each change, and gives the
// observers back on its return.
export function watchStuck<T>(props: {
  card: T;
  foot: T;
  hidden: number;
  bar: number;
  observe: Observe<T>;
  onChange(stuck: boolean): void;
}): () => void {
  let shows = false;
  let below = false;
  let was = false;
  const settle = () => {
    const now = shows && below;
    if (now !== was) props.onChange((was = now));
  };
  const stops = [
    props.observe(props.card, props.hidden + props.bar, (above) => {
      shows = above;
      settle();
    }),
    props.observe(props.foot, props.hidden, (above, under) => {
      below = !above && under;
      settle();
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

// Where a change set is against the room the window leaves above the
// composer, from the window's top to `room`: shown while half of it, or
// half the room when it's taller, shows there; otherwise above or below,
// by whether it ends above the room's bottom edge (OA-260, OA-272).
export type Box = { top: number; bottom: number };

export function placed(set: Box, room: number): "shown" | "above" | "below" {
  const shows = Math.min(set.bottom, room) - Math.max(set.top, 0);
  if (shows > 0 && shows * 2 >= Math.min(set.bottom - set.top, room)) return "shown";
  return set.bottom <= room ? "above" : "below";
}

// The IntersectionObservers that call back whenever `placed` can change,
// for a change set `height` tall: one on the room, at the share that is
// half of it, or of the room; and one from far above the window down to
// the room's bottom edge, at all of it. Each root's top, and its
// thresholds; their bottom is the room's.
export function watching(height: number, room: number): { top: number; thresholds: number[] }[] {
  return [
    { top: 0, thresholds: [Math.min(0.5, Math.max(1, room) / (2 * Math.max(1, height)))] },
    { top: -1000000, thresholds: [1] },
  ];
}
