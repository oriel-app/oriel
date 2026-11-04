// What a Sheets connection's last sync left out, as Settings lists it under
// the connection (decision 0050): rows that share a key or have none, by
// row number as the sheet shows them, for the person to fix in the sheet;
// rows hidden by hand that weren't read; a tab past the row cap; a tab or a
// spreadsheet that couldn't be read, and picks past the caps. A title is the
// spreadsheet's own, shown as text.
import { maxRows, maxSpreadsheets, maxTabs, type SheetsReport } from "./source.ts";

const rows = (numbers: readonly number[]) =>
  numbers.length === 1
    ? `row ${numbers[0]}`
    : `rows ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;

export function reportLines(report: SheetsReport): string[] {
  const lines = report.spreadsheets.flatMap((spreadsheet) => {
    const title = spreadsheet.title ?? "A spreadsheet";
    if (spreadsheet.problem === "gone") return [`${title} isn't there to read any more.`];
    if (spreadsheet.problem === "failed") return [`${title} didn't answer this time.`];
    return spreadsheet.tabs.flatMap((tab) => {
      const where = tab.title === null ? title : `${title}, ${tab.title}`;
      if (tab.stopped !== undefined) return [`${where}: not read, since ${tab.stopped}.`];
      return [
        ...(tab.duplicates.length > 0
          ? [`${where}: ${rows(tab.duplicates)} share a key, so none of them is an item yet.`]
          : []),
        ...(tab.keyless.length > 0
          ? [`${where}: ${rows(tab.keyless)} have no key, so they aren't items yet.`]
          : []),
        ...(tab.hidden > 0
          ? [`${where}: ${tab.hidden} hidden ${tab.hidden === 1 ? "row" : "rows"} not read.`]
          : []),
        ...(tab.capped
          ? [`${where}: read to its first ${maxRows.toLocaleString("en")} rows.`]
          : []),
      ];
    });
  });
  const { unread } = report;
  if (unread.spreadsheets > 0)
    lines.push(
      `${unread.spreadsheets} more ${unread.spreadsheets === 1 ? "spreadsheet" : "spreadsheets"} not read: a connection reads ${maxSpreadsheets}.`,
    );
  if (unread.tabs > 0)
    lines.push(
      `${unread.tabs} more ${unread.tabs === 1 ? "tab" : "tabs"} not read: a connection reads ${maxTabs}.`,
    );
  return lines;
}
