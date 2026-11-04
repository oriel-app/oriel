// A1 notation, as the Sheets API reads it: a tab's name, quoted when it must
// be, then `!` and the cells, such as `'Sprint 42'!A2:E6`, `Tracker!B:B`,
// `Tracker!5:9`, `Tracker!A5:A` (A5 down the column) or `Tracker!C3`. A range
// with no tab is on the first tab; a tab's name alone is all of it.
// https://developers.google.com/workspace/sheets/api/guides/concepts#cell
//
// Bounds are zero-based and half-open, as Google's GridRange is: "Indexes are
// half open, i.e. the start index is inclusive and the end index is
// exclusive", and "Missing indexes indicate the range is unbounded on that
// side."
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/other#GridRange

export type Bounds = {
  startRow?: number;
  endRow?: number;
  startColumn?: number;
  endColumn?: number;
};

export type A1Range = {
  // The tab's name as written, unquoted; null for the first tab.
  tab: string | null;
  // Null for the whole tab.
  bounds: Bounds | null;
};

// `A` is 0, `Z` 25, `AA` 26.
export function columnIndex(letters: string): number | null {
  if (!/^[A-Z]{1,3}$/.test(letters)) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

// One end of a range: a cell (`B7`), a column (`B`) or a row (`7`).
type End = { row?: number; column?: number };

function end(text: string): End | null {
  const match = /^([A-Z]{0,3})([0-9]{0,7})$/.exec(text);
  if (!match || text === "") return null;
  const [, letters = "", digits = ""] = match;
  const parsed: End = {};
  if (letters) {
    const column = columnIndex(letters);
    if (column === null) return null;
    parsed.column = column;
  }
  if (digits) {
    const row = Number(digits);
    if (row < 1) return null;
    parsed.row = row - 1;
  }
  return parsed;
}

// One cell, such as `B7`.
export function parseCell(text: string): { row: number; column: number } | null {
  const cell = end(text.toUpperCase());
  return cell?.row !== undefined && cell.column !== undefined
    ? { row: cell.row, column: cell.column }
    : null;
}

// The cells part of a range, upper case, with or without a second end.
export function parseBounds(text: string): Bounds | null {
  const [first, second, ...rest] = text.split(":");
  if (first === undefined || rest.length) return null;
  const from = end(first);
  if (!from) return null;
  if (second === undefined) {
    // One cell; a lone row or column isn't a range.
    if (from.row === undefined || from.column === undefined) return null;
    return {
      startRow: from.row,
      endRow: from.row + 1,
      startColumn: from.column,
      endColumn: from.column + 1,
    };
  }
  const to = end(second);
  if (!to) return null;
  // `A:B` and `2:4` are whole columns and rows; `A5:A` runs down from A5.
  // `5:A` isn't anything.
  if (from.column === undefined && to.column !== undefined) return null;
  if (from.row === undefined && to.row !== undefined) return null;
  const bounds: Bounds = {};
  if (from.row !== undefined) bounds.startRow = from.row;
  if (to.row !== undefined) bounds.endRow = to.row + 1;
  if (from.column !== undefined) bounds.startColumn = from.column;
  if (to.column !== undefined) bounds.endColumn = to.column + 1;
  if ((bounds.endRow ?? Infinity) <= (bounds.startRow ?? 0)) return null;
  if ((bounds.endColumn ?? Infinity) <= (bounds.startColumn ?? 0)) return null;
  return bounds;
}

// A whole range. A quoted name doubles any `'` in it.
export function parseRange(text: string): A1Range | null {
  if (text.startsWith("'")) {
    let tab = "";
    let i = 1;
    for (; i < text.length; i++) {
      if (text[i] !== "'") tab += text[i];
      else if (text[i + 1] === "'") {
        tab += "'";
        i++;
      } else break;
    }
    if (i >= text.length || tab === "") return null;
    const after = text.slice(i + 1);
    if (after === "") return { tab, bounds: null };
    if (!after.startsWith("!")) return null;
    const bounds = parseBounds(after.slice(1).toUpperCase());
    return bounds ? { tab, bounds } : null;
  }
  const bang = text.lastIndexOf("!");
  if (bang === -1) {
    const bounds = parseBounds(text.toUpperCase());
    return bounds ? { tab: null, bounds } : text ? { tab: text, bounds: null } : null;
  }
  const tab = text.slice(0, bang);
  const bounds = parseBounds(text.slice(bang + 1).toUpperCase());
  return tab && bounds ? { tab, bounds } : null;
}

// A tab's name as a range names it, quoted.
export function quoteTab(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}
