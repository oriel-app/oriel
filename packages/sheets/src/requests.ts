// The bodies of the writes Oriel sends Google Sheets (decision 0050), and
// nothing else: the writer sends them, and the live test sends the same
// ones to prove a value starting with `=` stays text. Values only:
//
// - An edit is `values.batchUpdate` with `valueInputOption=RAW`: "The values
//   the user has entered will not be parsed and will be stored as-is."
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption
// - A new row is inserted after the table's last row and filled in the same
//   `spreadsheets.batchUpdate`, with typed values: a string is a
//   `stringValue`, never a `formulaValue`.
//   https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/other#ExtendedValue
// - A revert's delete is a `deleteDimension`.
import { columnLetters, quoteTab } from "./a1.ts";

// What a write puts in a cell; null empties it.
export type CellValue = string | number | boolean | null;

// An edit of one cell, by its tab's name and its 0-based row and column.
// An empty string is how the values API empties a cell.
export function editBody(tab: string, row: number, column: number, value: CellValue) {
  return {
    valueInputOption: "RAW",
    data: [
      {
        range: `${quoteTab(tab)}!${columnLetters(column)}${row + 1}`,
        majorDimension: "ROWS",
        values: [[value ?? ""]],
      },
    ],
  };
}

// A value as Google's ExtendedValue types it. Nothing here makes a formula.
export function typed(value: CellValue): Record<string, unknown> {
  if (value === null) return {};
  if (typeof value === "string") return { userEnteredValue: { stringValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { boolValue: value } };
}

// A new row at the 0-based `index`, holding `cells` from column A, as one
// atomic `batchUpdate`. It takes the formatting of the row above unless
// that row is the header.
export function addRowBody(
  sheetId: number,
  index: number,
  cells: readonly CellValue[],
  underHeader: boolean,
) {
  return {
    requests: [
      {
        insertDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 },
          inheritFromBefore: !underHeader,
        },
      },
      {
        updateCells: {
          start: { sheetId, rowIndex: index, columnIndex: 0 },
          rows: [{ values: cells.map(typed) }],
          fields: "userEnteredValue",
        },
      },
    ],
  };
}

// Deletes the row at the 0-based `index`.
export function deleteRowBody(sheetId: number, index: number) {
  return {
    requests: [
      {
        deleteDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 },
        },
      },
    ],
  };
}
