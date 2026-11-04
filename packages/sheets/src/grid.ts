// A mapped tab's grid as Google gives it, read the one way a sync and a
// writer both read it (decision 0050): from its header row down, in chunks
// of rows near Google's recommended 2 MB a request, until the table has
// surely ended or is past the row cap.
import type { Google, TabInfo } from "./google.ts";
import type { TabMapping } from "./mapping.ts";
import type { Grid } from "./table.ts";

export const maxRows = 5_000;
// About Google's recommended 2 MB a request, at a generous 100 bytes a cell.
const chunkCells = 20_000;

// With `entered`, each cell carries what was entered in it too, as a
// writer reads it.
export async function readGrid(
  google: Google,
  id: string,
  tab: TabInfo,
  mapping: TabMapping,
  entered = false,
): Promise<Grid | "gone"> {
  const chunk = Math.max(100, Math.floor(chunkCells / Math.max(tab.columns, 1)));
  const start = mapping.header - 1;
  const grid: Grid & { rows: Grid["rows"][number][] } = {
    startRow: start,
    rows: [],
    hiddenRows: new Set(),
    hiddenColumns: new Set(),
    merges: [],
  };
  const merges = new Map<string, Grid["merges"][number]>();
  // The header and the cap's rows, blank ones included, and one more to
  // tell whether any followed.
  const limit = Math.min(tab.rows, start + maxRows + 2);
  for (let from = start; from < limit; from += chunk) {
    const to = Math.min(from + chunk, limit);
    const part = await google.rows(id, tab, from, to, entered);
    if (part === "gone") return part;
    const rows = part.rows;
    for (let r = 0; r < to - from; r++) grid.rows[from - start + r] = [...(rows[r] ?? [])];
    for (const r of part.hiddenRows) (grid.hiddenRows as Set<number>).add(r);
    for (const c of part.hiddenColumns) (grid.hiddenColumns as Set<number>).add(c);
    for (const m of part.merges) merges.set(JSON.stringify(m), m);
    // Google leaves out the empty rows at a range's end, so they count as
    // blank here; a table that runs to the grid's end reads on past them.
    const padded = Array.from({ length: to - from }, (_, r) => rows[r] ?? []);
    if (
      mapping.end === "blank" &&
      endsIn(padded, from === start ? 1 : 0, from, [...merges.values()])
    )
      break;
  }
  return { ...grid, merges: [...merges.values()] };
}

// Whether a blank row ends the table within these rows: one with nothing in
// it that no merge reaches into.
function endsIn(rows: Grid["rows"], from: number, top: number, merges: Grid["merges"]): boolean {
  for (let r = from; r < rows.length; r++) {
    const index = top + r;
    if ((rows[r] ?? []).some(Boolean)) continue;
    if (!merges.some((m) => m.startRow < index && index < m.endRow)) return true;
  }
  return false;
}
