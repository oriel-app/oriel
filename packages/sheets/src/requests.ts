// Values only: an edit is `RAW`, stored unparsed; a new row's text is a `stringValue`, not a formula.
// https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption
import { columnLetters, quoteTab } from "./a1.ts";

export type CellValue = string | number | boolean | null;

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

export function typed(value: CellValue): Record<string, unknown> {
  if (value === null) return {};
  if (typeof value === "string") return { userEnteredValue: { stringValue: value } };
  if (typeof value === "number") return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { boolValue: value } };
}

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
