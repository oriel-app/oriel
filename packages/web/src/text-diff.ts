// What changed between two versions of a field's text, for a diff to mark
// only the words that differ. Lines first, so a long description shows its
// changed lines among unchanged ones; then words within the changed lines.

// A run of text, and whether it differs from the other side.
export type Piece = { text: string; changed: boolean };

// Unchanged lines, or a change: the lines it replaces and those it puts in
// their place, with their changed words marked. Null when there are none.
export type Hunk =
  | { kind: "same"; lines: string[] }
  | { kind: "change"; before: Piece[] | null; after: Piece[] | null };

type Op = { kind: "same" | "removed" | "added"; text: string };

// Past this many cells, the middle of a sequence (after the shared start and
// end) counts as changed throughout instead of being compared item by item.
const maxCells = 250_000;
// Below this share of unchanged words, a change reads as a rewrite: marking
// the few words it shares would only scatter marks.
const minShared = 0.4;

// The longest common subsequence of two sequences, as the ops that turn one
// into the other.
function sequence(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const same = (text: string): Op => ({ kind: "same", text });
  return [
    ...a.slice(0, start).map(same),
    ...middle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(same),
  ];
}

function middle(a: readonly string[], b: readonly string[]): Op[] {
  const removed = (text: string): Op => ({ kind: "removed", text });
  const added = (text: string): Op => ({ kind: "added", text });
  if (a.length * b.length > maxCells) return [...a.map(removed), ...b.map(added)];
  // Each cell: the length of the longest common subsequence of a[i..], b[j..].
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] ?? "";
    const y = b[j] ?? "";
    if (x === y) {
      ops.push({ kind: "same", text: x });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      ops.push(removed(x));
      i += 1;
    } else {
      ops.push(added(y));
      j += 1;
    }
  }
  return [...ops, ...a.slice(i).map(removed), ...b.slice(j).map(added)];
}

// Words, runs of space, and each other character on its own.
const tokens = (text: string): string[] =>
  text.match(/\s+|[\p{L}\p{N}\p{M}_'’]+|[^\s\p{L}\p{N}\p{M}_'’]/gu) ?? [];

const isSpace = (text: string) => /^\s+$/.test(text);

// Adjacent pieces alike in being changed or not, as one, with the space at
// either end of a change, or a change of space alone, left unmarked: where a
// comparison puts a space is arbitrary, and a marked space reads as nothing.
function joined(pieces: readonly Piece[]): Piece[] {
  const merge = (list: readonly Piece[]) => {
    const out: Piece[] = [];
    for (const piece of list) {
      const last = out.at(-1);
      if (piece.text === "") continue;
      if (last && last.changed === piece.changed) last.text += piece.text;
      else out.push({ ...piece });
    }
    return out;
  };
  return merge(
    merge(pieces).flatMap((piece) => {
      if (!piece.changed) return [piece];
      if (isSpace(piece.text)) return [{ ...piece, changed: false }];
      // Measured by trimming, not a pattern, so a long run of space stays fast.
      const { text } = piece;
      const start = text.length - text.trimStart().length;
      const end = text.trimEnd().length;
      return [
        { text: text.slice(0, start), changed: false },
        { text: text.slice(start, end), changed: true },
        { text: text.slice(end), changed: false },
      ];
    }),
  );
}

// Both texts, each with the words it doesn't share with the other marked.
// Space between two changes counts as changed, so a changed phrase is
// marked as one.
export function words(before: string, after: string): { before: Piece[]; after: Piece[] } {
  const ops = sequence(tokens(before), tokens(after));
  const was: Piece[] = [];
  const now: Piece[] = [];
  ops.forEach((op, i) => {
    if (op.kind === "removed") was.push({ text: op.text, changed: true });
    if (op.kind === "added") now.push({ text: op.text, changed: true });
    if (op.kind !== "same") return;
    const between =
      isSpace(op.text) && ops[i - 1]?.kind !== "same" && ops[i + 1]?.kind !== "same" && i > 0;
    was.push({ text: op.text, changed: between });
    now.push({ text: op.text, changed: between });
  });
  const wordsOf = (pieces: Piece[]) => pieces.filter((p) => !isSpace(p.text));
  const shared = wordsOf(was).filter((p) => !p.changed).length;
  const most = Math.max(wordsOf(was).length, wordsOf(now).length);
  if (most > 0 && shared / most < minShared)
    return {
      before: before ? [{ text: before, changed: true }] : [],
      after: after ? [{ text: after, changed: true }] : [],
    };
  return { before: joined(was), after: joined(now) };
}

// The texts by line: runs of unchanged lines, and each change between them.
// An empty text has no lines.
export function lines(before: string, after: string): Hunk[] {
  const split = (text: string) => (text === "" ? [] : text.replaceAll("\r\n", "\n").split("\n"));
  const hunks: Hunk[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    const was = removed.join("\n");
    const now = added.join("\n");
    if (removed.length > 0 && added.length > 0) {
      const marked = words(was, now);
      hunks.push({ kind: "change", before: marked.before, after: marked.after });
    } else
      hunks.push({
        kind: "change",
        before: removed.length > 0 ? [{ text: was, changed: true }] : null,
        after: added.length > 0 ? [{ text: now, changed: true }] : null,
      });
    removed = [];
    added = [];
  };
  for (const op of sequence(split(before), split(after))) {
    if (op.kind === "removed") removed.push(op.text);
    if (op.kind === "added") added.push(op.text);
    if (op.kind !== "same") continue;
    flush();
    const last = hunks.at(-1);
    if (last?.kind === "same") last.lines.push(op.text);
    else hunks.push({ kind: "same", lines: [op.text] });
  }
  flush();
  return hunks;
}
