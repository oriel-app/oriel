import type { DiffView } from "./view.ts";

type Line = DiffView["lines"][number];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const pluralOf = (noun: string): string =>
  /[^aeiou]y$/.test(noun)
    ? `${noun.slice(0, -1)}ies`
    : /(s|x|z|ch|sh)$/.test(noun)
      ? `${noun}es`
      : `${noun}s`;

const andList = (names: readonly string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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

export const sourcesOf = (diff: DiffView): string =>
  andList([...new Set(diff.lines.map((line) => line.source))]);

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function titled(quoted: string, title: string | null | undefined): boolean {
  const said = title?.replace(/\s+/g, " ").trim();
  if (!said) return false;
  return quoted === said || (quoted.endsWith("…") && said.startsWith(quoted.slice(0, -1)));
}

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

export type Observe<T> = (
  target: T,
  margin: number,
  seen: (above: boolean, below: boolean) => void,
) => () => void;

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

export type Box = { top: number; bottom: number };

export function placed(set: Box, room: number): "shown" | "above" | "below" {
  const shows = Math.min(set.bottom, room) - Math.max(set.top, 0);
  if (shows > 0 && shows * 2 >= Math.min(set.bottom - set.top, room)) return "shown";
  return set.bottom <= room ? "above" : "below";
}

export function watching(height: number, room: number): { top: number; thresholds: number[] }[] {
  return [
    { top: 0, thresholds: [Math.min(0.5, Math.max(1, room) / (2 * Math.max(1, height)))] },
    { top: -1000000, thresholds: [1] },
  ];
}
