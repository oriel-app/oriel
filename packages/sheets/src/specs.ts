// How change sets treat Google Sheets' ops (decision 0050). Field names are
// Oriel's, as a tab maps them (`key`, `title`, `status`, `assignee`,
// `estimate`, `link`), each the cell's value as entered: text, a number, a
// boolean, or null for an empty cell. `cells` is a digest of everything the
// row holds, so any edit to the row moves it, and an edit elsewhere in the
// spreadsheet doesn't.
//
// Apply writes a cell only while it holds what the diff showed, and never
// over a formula. Reverting an edit stops if the cell changed since Oriel
// wrote it; reverting an added row stops if anything in the row changed.
import { type Conflict, type LineContext, op, type OpSpec, type OpSpecs } from "@oriel/core";
import { type SheetsOp, sheetsOps } from "./ops.ts";

const maxQuoted = 80;

function quoted(value: unknown): string {
  const chars = [...String(value).replace(/\s+/g, " ").trim()];
  const short =
    chars.length > maxQuoted ? `${chars.slice(0, maxQuoted - 1).join("")}…` : chars.join("");
  return `“${short}”`;
}

// The row a line writes to, by its title as the change set leaves it.
const rowOf = (context: LineContext) => {
  const title = context.subject?.title ?? null;
  return title === null ? "the row" : `the row ${quoted(title)}`;
};

// A tab, by its name and its spreadsheet's, where Oriel knows them.
async function tabOf(context: LineContext, spreadsheet: string, sheetId: number): Promise<string> {
  const tab = await context.name(`${spreadsheet}/${sheetId}`);
  const file = await context.name(spreadsheet);
  if (tab === null) return file === null ? "a spreadsheet's tab" : `a tab of ${quoted(file)}`;
  return file === null ? `the tab ${quoted(tab)}` : `the tab ${quoted(tab)} of ${quoted(file)}`;
}

const ops: Record<SheetsOp, OpSpec> = {
  setField: op(sheetsOps.setField, {
    // Writing a cell twice leaves it as writing it once does.
    idempotent: true,
    after: (a) => ({ [a.field]: a.value }),
    describe: (a, context) =>
      a.value === null
        ? `Empty the ${a.field} cell of ${rowOf(context)}.`
        : `Set the ${a.field} cell of ${rowOf(context)} to ${quoted(a.value)}, as a value.`,
    undo: (a, applied) => {
      if (!Object.hasOwn(applied.before, a.field))
        return { refused: `Google Sheets didn't report the ${a.field} cell before Oriel wrote it` };
      const args = { field: a.field, value: applied.before[a.field] };
      return sheetsOps.setField.args(args).ok
        ? { op: "setField", args }
        : { refused: `the ${a.field} cell held something Oriel can't write back` };
    },
  }),
  addRow: op(sheetsOps.addRow, {
    creates: true,
    makes: "row",
    // The fields it fills; one left out stays empty.
    after: (a) => Object.fromEntries(Object.entries(a.values).filter(([, v]) => v !== undefined)),
    describe: async (a, context) =>
      `Add a row after the last of ${await tabOf(context, a.spreadsheet, a.sheetId)}.`,
    undo: () => ({ op: "deleteRow", args: {} }),
  }),
  deleteRow: op(sheetsOps.deleteRow, {
    deletes: true,
    after: () => ({}),
    describe: (_a, context) => `Delete ${rowOf(context)}, which Oriel added.`,
    undo: () => ({ refused: "a deleted row can't be added again by a revert" }),
  }),
};

// Why a revert stopped, naming the row by its title: its key is a hash.
function explain(conflict: Conflict, title: string | null): string {
  const named = title === null ? "a spreadsheet row" : `the row ${quoted(title)}`;
  const { field, expected, actual } = conflict;
  if (field === "item") return `${named} isn't in the spreadsheet any more, or its key changed`;
  if (field === "cells")
    return expected === undefined || expected === null
      ? `Oriel never learned what ${named} held, so it can't tell whether anyone edited it`
      : `${named} was edited since Oriel added it, so deleting it could take someone's edit with it`;
  if (expected === undefined)
    return `Oriel is missing ${named}'s ${field} cell from when this was applied, so it can't put it back safely`;
  return `${named}'s ${field} cell is now ${actual === null ? "empty" : quoted(actual)}, not ${expected === null ? "empty" : quoted(expected)}`;
}

// What the composition root hands change sets for Google Sheets.
export const sheetsSpecs: OpSpecs = {
  name: "Google Sheets",
  titleField: "title",
  updatedField: "cells",
  fields: {
    key: "value",
    title: "value",
    status: "value",
    assignee: "value",
    estimate: "value",
    link: "value",
  },
  ops,
  explain,
};
