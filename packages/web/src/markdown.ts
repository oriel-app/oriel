// The markdown an agent writes, as plain data the page renders as elements:
// paragraphs, headings, lists, quotes, code, tables and rules, with bold,
// italics, code and links inside them: to the web, or to a thread in Oriel,
// as the agent's thread.* reads give it. It never becomes HTML, since a reply can
// quote source content anyone can write. A reply is read while it streams, so
// a mark without its closing half stays as typed. In an agent's answer only,
// `[[id]]` is a chip, and a quote whose first line is one is quoted from it
// (decision 0032); anywhere else, as in a source's own text, each is text.
import { inAppRoute, type Route, safeHref } from "./route.ts";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "route"; route: Route; children: Inline[] }
  // A person or a channel a source's text names; markdown has neither.
  | { kind: "mention" | "channel"; text: string }
  // `[[id]]` in an agent's answer: an item, thread, change set or workstream
  // by its ID, which Oriel draws with its name and state.
  | { kind: "chip"; id: string };

export type Prose =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; tight: boolean; items: Prose[][] }
  | { kind: "quote"; children: Prose[] }
  // A quote from the item `id` names, as its lines after the chip say it
  // (`text`): Oriel checks it against that item as the turn ends.
  | { kind: "quote-from"; id: string; text: string; children: Prose[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const blank = (line: string) => line.trim() === "";
const indent = (line: string) => line.length - line.trimStart().length;

// Each pattern runs in steps linear in the line: a line is source content
// the agent may quote, and is read again with every streamed chunk. `s` lets
// `.` take any character, so `$` can't fail after a long backtrack.
const fence = /^ {0,3}(`{3,}|~{3,})/;
const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/s;
const rule = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const quote = /^ {0,3}> ?(.*)$/s;
const marker = /^( *)([-*+]|(\d{1,9})[.)])(?:([ \t]+)(.*))?$/s;

// A heading's text without the closing `#`s some writers add.
function headingText(raw: string): string {
  const text = raw.trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  return end === 0 || text[end - 1] === " " || text[end - 1] === "\t"
    ? text.slice(0, end).trimEnd()
    : text;
}

// A table's second line: one `---` cell, aligned or not, for each heading.
function tableRule(line: string, columns: number): boolean {
  // One column needs a `|` on this line too, or any `---` under a line
  // ending in `|` would make a table.
  if (columns === 1 && !line.includes("|")) return false;
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length === columns && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

// The fence a line opens. Backticks with another backtick after them on the
// line are code inside a sentence, not a fence.
function fenceOf(line: string): string | undefined {
  const opened = fence.exec(line)?.[1];
  if (opened?.[0] === "`" && line.includes("`", line.indexOf(opened) + opened.length))
    return undefined;
  return opened;
}

// Whether lines[i] heads a table: the line under it rules one cell per heading.
const startsTable = (lines: readonly string[], i: number) => {
  const line = lines[i] ?? "";
  return line.includes("|") && tableRule(lines[i + 1] ?? "", cellTexts(line).length);
};

// Whether lines[i] starts a block, and so ends the paragraph above it.
const startsBlock = (lines: readonly string[], i: number) => {
  const line = lines[i] ?? "";
  return (
    fenceOf(line) !== undefined ||
    heading.test(line) ||
    rule.test(line) ||
    quote.test(line) ||
    marker.test(line) ||
    startsTable(lines, i)
  );
};

// Quotes, lists and marks nest at most this deep; deeper, they read as text.
const deepest = 8;

// `chips`: whether `[[id]]` is a chip, as in an agent's answer, and only there.
export function parse(text: string, { chips = false } = {}): Prose[] {
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"), 0, chips);
}

// What `[[…]]` holds to be a chip: an item's ID, qualified by its connection
// (`kind:KEY-45`, or `kind.2:KEY-4` from a later connection), or one of Oriel's own, a ULID. Anything
// else stays as typed. Loose, so an ID Oriel doesn't know gets its note, and
// bounded, so the ID fits it.
const chipId = /^(?:[a-z]{1,20}(?:\.[0-9]{1,4})?:[^\s[\]]{1,500}|[0-9A-HJKMNP-TV-Z]{26})$/;

// The IDs an agent's answer names as chips, once each, in order.
export function chipIds(text: string): string[] {
  const found = new Set<string>();
  const inlines = (each: readonly Inline[]) => {
    for (const one of each) {
      if (one.kind === "chip") found.add(one.id);
      else if ("children" in one) inlines(one.children);
    }
  };
  const proses = (each: readonly Prose[]) => {
    for (const one of each) {
      if (one.kind === "paragraph" || one.kind === "heading") inlines(one.children);
      else if (one.kind === "quote") proses(one.children);
      else if (one.kind === "quote-from") {
        found.add(one.id);
        proses(one.children);
      } else if (one.kind === "list") one.items.forEach(proses);
      else if (one.kind === "table") [one.head, ...one.rows].flat().forEach(inlines);
    }
  };
  proses(parse(text, { chips: true }));
  return [...found];
}

// What an agent's answer quotes from items, each once, in order, nested ones
// too. A quote reads as one only with its item and its text both, which is
// how Oriel finds its check again.
export type QuoteFrom = { id: string; text: string };

export function quotesFrom(text: string): QuoteFrom[] {
  const found = new Map<string, QuoteFrom>();
  const proses = (each: readonly Prose[]) => {
    for (const one of each) {
      if (one.kind === "quote-from") found.set(quoteKey(one), { id: one.id, text: one.text });
      if (one.kind === "quote" || one.kind === "quote-from") proses(one.children);
      else if (one.kind === "list") one.items.forEach(proses);
    }
  };
  proses(parse(text, { chips: true }));
  return [...found.values()];
}

export const quoteKey = (quote: QuoteFrom): string => `${quote.id}\n${quote.text}`;

// A quote's first line, alone, as a chip: `> [[kind:KEY-45]]`.
const quotedChip = /^\s*\[\[\s*([^\][\s]+)\s*\]\]\s*$/;

function blocks(lines: readonly string[], depth: number, chips: boolean): Prose[] {
  const nests = depth < deepest;
  const out: Prose[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) {
      i++;
      continue;
    }
    const opened = fenceOf(line);
    if (opened) {
      // Closed by a fence of the same kind at least as long, or by the end.
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const closing = fence.exec(next)?.[1];
        i++;
        if (
          closing !== undefined &&
          closing[0] === opened[0] &&
          closing.length >= opened.length &&
          blank(next.slice(next.indexOf(closing) + closing.length))
        )
          break;
        code.push(next);
      }
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const titled = heading.exec(line);
    if (titled) {
      out.push({
        kind: "heading",
        level: titled[1]?.length ?? 1,
        children: inline(headingText(titled[2] ?? ""), 0, chips),
      });
      i++;
      continue;
    }
    if (rule.test(line)) {
      out.push({ kind: "rule" });
      i++;
      continue;
    }
    if (nests && quote.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && quote.test(lines[i] ?? "")) {
        quoted.push(quote.exec(lines[i] ?? "")?.[1] ?? "");
        i++;
      }
      const from = chips ? quotedChip.exec(quoted[0] ?? "")?.[1] : undefined;
      const said = quoted.slice(1);
      const text = said.join("\n").trim();
      out.push(
        from !== undefined && chipId.test(from) && text !== ""
          ? { kind: "quote-from", id: from, text, children: blocks(said, depth + 1, chips) }
          : { kind: "quote", children: blocks(quoted, depth + 1, chips) },
      );
      continue;
    }
    if (nests && marker.test(line)) {
      i = list(lines, i, out, depth, chips);
      continue;
    }
    if (startsTable(lines, i)) {
      const head = cells(line, chips);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i] ?? "") && (lines[i] ?? "").includes("|")) {
        rows.push(cells(lines[i] ?? "", chips));
        i++;
      }
      out.push({ kind: "table", head, rows });
      continue;
    }
    const said: string[] = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i] ?? "") && !startsBlock(lines, i)) {
      said.push((lines[i] ?? "").trim());
      i++;
    }
    out.push({ kind: "paragraph", children: joined(said, chips) });
  }
  return out;
}

// A list runs while its items share a marker kind. A line indented past the
// marker belongs to the item above it, as does a line that starts nothing new.
function list(
  lines: readonly string[],
  from: number,
  out: Prose[],
  depth: number,
  chips: boolean,
): number {
  const first = marker.exec(lines[from] ?? "");
  const ordered = first?.[3] !== undefined;
  const kind = (found: RegExpExecArray | null) =>
    found ? (found[3] !== undefined ? found[2]?.at(-1) : found[2]) : undefined;
  const sameKind = kind(first);
  const base = first?.[1]?.length ?? 0;
  // Each item's lines, and the column its own text starts at.
  const items: { lines: string[]; at: number }[] = [];
  let tight = true;
  let gap = false;
  let i = from;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const found = marker.exec(line);
    if (found && indent(line) <= base && !rule.test(line)) {
      if (kind(found) !== sameKind) break;
      if (gap) tight = false;
      gap = false;
      const width = (found[1]?.length ?? 0) + (found[2]?.length ?? 0);
      const space = found[4]?.length ?? 1;
      items.push({ lines: [found[5] ?? ""], at: width + (space > 4 ? 1 : space) });
      i++;
      continue;
    }
    const item = items.at(-1);
    if (!item) break;
    if (blank(line)) {
      gap = true;
      item.lines.push("");
      i++;
      continue;
    }
    if (indent(line) > base) {
      if (gap) tight = false;
      gap = false;
      item.lines.push(line.slice(Math.min(indent(line), item.at)));
      i++;
      continue;
    }
    if (gap || startsBlock(lines, i)) break;
    item.lines.push(line.trim());
    i++;
  }
  out.push({
    kind: "list",
    ordered,
    start: ordered ? Number(first?.[3]) : 1,
    tight,
    items: items.map((item) => blocks(item.lines, depth + 1, chips)),
  });
  return i;
}

// A table line's cells, split at each `|` that isn't escaped as `\|`.
function cellTexts(line: string): string[] {
  const trimmed = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

const cells = (line: string, chips: boolean): Inline[][] =>
  cellTexts(line).map((cell) => inline(cell, 0, chips));

// A paragraph's lines, with each line break kept: agents break lines on purpose.
function joined(lines: readonly string[], chips: boolean): Inline[] {
  return lines.flatMap((line, i) =>
    i === 0 ? inline(line, 0, chips) : [{ kind: "break" as const }, ...inline(line, 0, chips)],
  );
}

const punctuation = /[!-/:-@[-`{-~]/;
const word = /[\p{L}\p{N}]/u;
const space = (char: string | undefined) => char === undefined || /\s/.test(char);

// How many of `char` start at `at`.
function runAt(text: string, at: number, char: string): number {
  let end = at;
  while (text[end] === char) end++;
  return end - at;
}

// One line, read once whatever it holds: each `[` knows its `]` before the
// line is read, and a search for a mark's closing half that found none is
// remembered, since one from further on finds none either.
type Line = {
  text: string;
  depth: number;
  chips: boolean;
  brackets: Map<number, number>;
  failed: Map<string, number>;
};

export function inline(text: string, depth = 0, chips = false): Inline[] {
  if (depth >= deepest) return text === "" ? [] : [{ kind: "text", text }];
  const brackets = new Map<number, number>();
  const open: number[] = [];
  for (let j = 0; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "[") open.push(j);
    else if (text[j] === "]") {
      const from = open.pop();
      if (from !== undefined) brackets.set(from, j);
    }
  }
  const line: Line = { text, depth, chips, brackets, failed: new Map() };
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push({ kind: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i] ?? "";
    if (char === "\\" && punctuation.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "`") {
      const run = runAt(text, i, "`");
      const close = closingTicks(line, i + run, run);
      if (close >= 0) {
        flush();
        const code = text.slice(i + run, close);
        const padded =
          code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "";
        out.push({ kind: "code", text: padded ? code.slice(1, -1) : code });
        i = close + run;
        continue;
      }
      plain += "`".repeat(run);
      i += run;
      continue;
    }
    if (char === "[") {
      const named = chip(line, i);
      if (named) {
        flush();
        out.push(named.node);
        i = named.end;
        continue;
      }
      const linked = link(line, i);
      if (linked) {
        flush();
        out.push(linked.node);
        i = linked.end;
        continue;
      }
    }
    if (char === "*" || char === "_") {
      const marked = emphasis(line, i, char);
      if (marked) {
        plain += marked.lead;
        flush();
        out.push(marked.node);
        i = marked.end;
        continue;
      }
      // An unmatched run stays as typed, whole, so its halves aren't reused.
      const run = runAt(text, i, char);
      plain += char.repeat(run);
      i += run;
      continue;
    }
    plain += char;
    i++;
  }
  flush();
  return out;
}

// `[[id]]`, its two pairs of brackets each other's, holding a chip's ID, in
// a line that reads chips.
function chip(line: Line, from: number): { node: Inline; end: number } | null {
  if (!line.chips || line.text[from + 1] !== "[") return null;
  const inner = line.brackets.get(from + 1);
  if (inner === undefined || line.brackets.get(from) !== inner + 1) return null;
  const id = line.text.slice(from + 2, inner).trim();
  return chipId.test(id) ? { node: { kind: "chip", id }, end: inner + 2 } : null;
}

// Where `from` is past every place a search for `key` already failed from.
const failedBefore = (line: Line, key: string, from: number) =>
  from >= (line.failed.get(key) ?? Number.POSITIVE_INFINITY);

function closingTicks(line: Line, from: number, length: number): number {
  const key = "`".repeat(length);
  if (failedBefore(line, key, from)) return -1;
  let at = line.text.indexOf("`", from);
  while (at >= 0) {
    const run = runAt(line.text, at, "`");
    if (run === length) return at;
    at = line.text.indexOf("`", at + run);
  }
  line.failed.set(key, from);
  return -1;
}

// Whether a reply's link opens, given the sites the thread's items come from:
// a reply can be steered by what it quotes, so a link elsewhere could send what
// it carries in its address anywhere, behind a label that says otherwise.
export const opens = (href: string, sites: ReadonlySet<string>): boolean =>
  sites.has(URL.parse(href)?.origin ?? "");

// What follows a link's label: `(`, its target, an optional title in quotes
// or parentheses, and `)`, with spaces between them. The target is an address
// without spaces, its parentheses in pairs as in `wiki/Foo_(bar)`, or any text
// in `<…>`. A `[` or `]` ends the scan, and so does running past this many
// characters, so each part of a line is read for one link at most. The cost:
// a link whose address or title holds a bracket (`?f[a]=1`, `"[OA-13] …"`)
// stays as typed.
const longestTarget = 2_048;

// `[label](https://…)`, or `[label](/threads/…)` to a thread in Oriel. A link
// that is to neither stays as typed.
function link(line: Line, from: number): { node: Inline; end: number } | null {
  const { text } = line;
  const close = line.brackets.get(from);
  if (close === undefined || text[close + 1] !== "(") return null;
  const last = Math.min(text.length, close + 2 + longestTarget);
  const stops = (char: string | undefined) => char === "[" || char === "]";
  let at = close + 2;
  const skipSpaces = () => {
    while (at < last && (text[at] === " " || text[at] === "\t")) at++;
  };
  skipSpaces();
  let target: string;
  if (text[at] === "<") {
    const begin = ++at;
    while (at < last && text[at] !== ">" && text[at] !== "<" && !stops(text[at])) at++;
    if (text[at] !== ">") return null;
    target = text.slice(begin, at);
    at++;
  } else {
    const begin = at;
    let open = 0;
    while (at < last && !space(text[at]) && !stops(text[at]) && (text[at] !== ")" || open > 0)) {
      if (text[at] === "(") open++;
      else if (text[at] === ")") open--;
      at++;
    }
    target = text.slice(begin, at);
  }
  skipSpaces();
  const quote = text[at] === '"' || text[at] === "'" ? text[at] : text[at] === "(" ? ")" : null;
  if (quote) {
    at++;
    while (at < last && text[at] !== quote && !stops(text[at])) at++;
    if (text[at] !== quote) return null;
    at++;
    skipSpaces();
  }
  if (text[at] !== ")") return null;
  const children = () => inline(text.slice(from + 1, close), line.depth + 1, line.chips);
  const route = inAppRoute(target);
  if (route) return { node: { kind: "route", route, children: children() }, end: at + 1 };
  const href = safeHref(target);
  if (!href) return null;
  return { node: { kind: "link", href, children: children() }, end: at + 1 };
}

// `**strong**`, `*em*`, `***both***`, and the same with `_`. An opening mark is
// followed by a non-space, a closing one follows a non-space, and an `_` inside
// a word (snake_case) marks nothing. Of a longer opening run, the marks that
// open nothing stay as typed in front.
function emphasis(
  line: Line,
  from: number,
  char: "*" | "_",
): { lead: string; node: Inline; end: number } | null {
  const { text } = line;
  const run = runAt(text, from, char);
  if (space(text[from + run])) return null;
  if (char === "_" && word.test(text[from - 1] ?? "")) return null;
  for (const size of [3, 2, 1].filter((size) => size <= run)) {
    const open = from + run;
    const close = closingMark(line, open, char, size);
    if (close < 0) continue;
    const inner = inline(text.slice(open, close), line.depth + 1, line.chips);
    const node: Inline =
      size === 3
        ? { kind: "strong", children: [{ kind: "em", children: inner }] }
        : { kind: size === 2 ? "strong" : "em", children: inner };
    return { lead: char.repeat(run - size), node, end: close + size };
  }
  return null;
}

// Where a mark of this size closes: a run as long as it, or `***`, which
// closes it with its last marks (`*a **b***`). Other runs are nested marks.
function closingMark(line: Line, from: number, char: string, size: number): number {
  const key = char.repeat(size);
  if (failedBefore(line, key, from)) return -1;
  const { text } = line;
  let j = from;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text[j] === "`") {
      const run = runAt(text, j, "`");
      const close = closingTicks(line, j + run, run);
      j = close >= 0 ? close + run : j + run;
      continue;
    }
    if (text[j] !== char) {
      j++;
      continue;
    }
    const length = runAt(text, j, char);
    const closes =
      (length === size || length === 3) &&
      j > from &&
      !space(text[j - 1]) &&
      (char !== "_" || !word.test(text[j + length] ?? ""));
    if (closes) return j + length - size;
    j += length;
  }
  line.failed.set(key, from);
  return -1;
}
