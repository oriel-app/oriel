// The markdown an agent writes, as plain data the page renders as elements:
// paragraphs, headings, lists, quotes, code, tables and rules, with bold,
// italics, code and links inside them. It never becomes HTML, since a reply can
// quote source content anyone can write. A reply is read while it streams, so
// a mark without its closing half stays as typed.
import { safeHref } from "./route.ts";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type Prose =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; tight: boolean; items: Prose[][] }
  | { kind: "quote"; children: Prose[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const blank = (line: string) => line.trim() === "";
const indent = (line: string) => line.length - line.trimStart().length;

const fence = /^ {0,3}(`{3,}|~{3,})/;
const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const rule = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const quote = /^ {0,3}> ?(.*)$/;
const marker = /^( *)([-*+]|(\d{1,9})[.)])(?:([ \t]+)(.*))?$/;
const tableRule = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

const startsBlock = (line: string) =>
  fence.test(line) ||
  heading.test(line) ||
  rule.test(line) ||
  quote.test(line) ||
  marker.test(line);

// Quotes, lists and marks nest at most this deep; deeper, they read as text.
const deepest = 8;

export function parse(text: string): Prose[] {
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

function blocks(lines: readonly string[], depth: number): Prose[] {
  const nests = depth < deepest;
  const out: Prose[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (blank(line)) {
      i++;
      continue;
    }
    const opened = fence.exec(line)?.[1];
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
        children: inline(titled[2] ?? ""),
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
      out.push({ kind: "quote", children: blocks(quoted, depth + 1) });
      continue;
    }
    if (nests && marker.test(line)) {
      i = list(lines, i, out, depth);
      continue;
    }
    if (line.includes("|") && tableRule.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i] ?? "") && (lines[i] ?? "").includes("|")) {
        rows.push(cells(lines[i] ?? ""));
        i++;
      }
      out.push({ kind: "table", head, rows });
      continue;
    }
    const said: string[] = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i] ?? "") && !startsBlock(lines[i] ?? "")) {
      said.push((lines[i] ?? "").trim());
      i++;
    }
    out.push({ kind: "paragraph", children: joined(said) });
  }
  return out;
}

// A list runs while its items share a marker kind. A line indented past the
// marker belongs to the item above it, as does a line that starts nothing new.
function list(lines: readonly string[], from: number, out: Prose[], depth: number): number {
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
    if (gap || startsBlock(line)) break;
    item.lines.push(line.trim());
    i++;
  }
  out.push({
    kind: "list",
    ordered,
    start: ordered ? Number(first?.[3]) : 1,
    tight,
    items: items.map((item) => blocks(item.lines, depth + 1)),
  });
  return i;
}

function cells(line: string): Inline[][] {
  const trimmed = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => inline(cell.trim().replaceAll("\\|", "|")));
}

// A paragraph's lines, with each line break kept: agents break lines on purpose.
function joined(lines: readonly string[]): Inline[] {
  return lines.flatMap((line, i) =>
    i === 0 ? inline(line) : [{ kind: "break" as const }, ...inline(line)],
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
  brackets: Map<number, number>;
  failed: Map<string, number>;
};

export function inline(text: string, depth = 0): Inline[] {
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
  const line: Line = { text, depth, brackets, failed: new Map() };
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

// `[label](https://…)`. A link that isn't to the web stays as typed.
function link(line: Line, from: number): { node: Inline; end: number } | null {
  const { text } = line;
  const close = line.brackets.get(from);
  if (close === undefined || text[close + 1] !== "(") return null;
  const end = text.indexOf(")", close + 2);
  if (end < 0) return null;
  const target =
    text
      .slice(close + 2, end)
      .trim()
      .replace(/^<(.*)>$/, "$1")
      .split(/\s+/)[0] ?? "";
  const href = safeHref(target);
  if (!href) return null;
  return {
    node: { kind: "link", href, children: inline(text.slice(from + 1, close), line.depth + 1) },
    end: end + 1,
  };
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
    const inner = inline(text.slice(open, close), line.depth + 1);
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
