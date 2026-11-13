// Text stays text, even starting with `=`: nothing here can make a formula.
import {
  boolean,
  type Infer,
  literal,
  nullable,
  number,
  object,
  type OpCatalogue,
  optional,
  refine,
  string,
  union,
} from "@oriel/core";

// How long a cell's text may be, in characters. Google takes 50,000, but a
// person approves every word of it.
export const maxText = 10_000;

// A row's key is what finds it, so it's set only when the row is added.
export const editableFields = ["title", "status", "assignee", "estimate", "link"] as const;
export type EditableField = (typeof editableFields)[number];

const text = refine(
  string,
  (value) => [...value].length <= maxText,
  `expected at most ${maxText} characters`,
);
const filled = refine(text, (value) => value.trim() !== "", "expected some text");
const finite = refine(number, Number.isFinite, "expected a finite number");
const field = union(...editableFields.map((name) => literal(name)));
const value = nullable(union(text, finite, boolean));

export const sheetsOps = {
  setField: {
    args: refine(
      object({ field, value }),
      (args) =>
        args.field !== "title" || (typeof args.value === "string" && args.value.trim() !== ""),
      "expected a title that isn't empty",
    ),
    revertOnly: false,
  },
  addRow: {
    args: object({
      spreadsheet: refine(
        string,
        (s) => /^[A-Za-z0-9_-]{10,100}$/.test(s),
        "expected a Drive file ID",
      ),
      sheetId: refine(number, (n) => Number.isInteger(n) && n >= 0, "expected a sheetId"),
      values: object({
        key: filled,
        title: filled,
        status: optional(text),
        assignee: optional(text),
        estimate: optional(finite),
        link: optional(text),
      }),
    }),
    revertOnly: false,
  },
  deleteRow: { args: object({}), revertOnly: true },
} as const satisfies OpCatalogue;

export type SheetsOp = keyof typeof sheetsOps;
export type SheetsArgs<O extends SheetsOp> = Infer<(typeof sheetsOps)[O]["args"]>;

export function isSheetsOp(op: string): op is SheetsOp {
  return Object.hasOwn(sheetsOps, op);
}
