// Bounds are zero-based and half-open, as Google's GridRange is; a missing index is unbounded.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/other#GridRange

export type Bounds = {
  startRow?: number;
  endRow?: number;
  startColumn?: number;
  endColumn?: number;
};

export type A1Range = {
  tab: string | null;
  bounds: Bounds | null;
};

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

export function parseCell(text: string): { row: number; column: number } | null {
  const cell = end(text.toUpperCase());
  return cell?.row !== undefined && cell.column !== undefined
    ? { row: cell.row, column: cell.column }
    : null;
}

export function parseBounds(text: string): Bounds | null {
  const [first, second, ...rest] = text.split(":");
  if (first === undefined || rest.length) return null;
  const from = end(first);
  if (!from) return null;
  if (second === undefined) {
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

export function quoteTab(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}
