// The `sheets` namespace of a region's module (decision 0050): editing one
// mapped cell of a row, and adding a row to a row's tab, each by Oriel's
// field names, never a header. Bindings build it only for a region holding
// rows Oriel may change: rows of a mapped tab, in a spreadsheet the person
// can edit, through a connection that may propose changes. Reading a row is
// `items.read()`, as for any item.
import {
  idUnion,
  type IndexRecord,
  type ItemId,
  type NamespaceFn,
  type NamespaceSpec,
  object,
  optional,
  param,
  refine,
  string,
  union,
  literal,
  nullable,
  number,
  write,
} from "@oriel/core";
import { sheetsAttrsOf } from "./attrs.ts";
import { type FieldName, mappedColumns, type SheetsPicks } from "./mapping.ts";
import { type EditableField, editableFields, maxText, sheetsOps } from "./ops.ts";

// What only the composition root knows: each mapped tab's fields, by
// `<spreadsheet ID>/<sheetId>`. Absent for a read-only connection, which
// offers nothing to write.
export type SheetsContext = { tabs: Readonly<Record<string, readonly FieldName[]>> } | undefined;

const tabKey = (spreadsheet: string, sheetId: number) => `${spreadsheet}/${sheetId}`;

// The context of a connection that may propose changes, from its picks.
export function sheetsContextOf(picks: SheetsPicks): NonNullable<SheetsContext> {
  return {
    tabs: Object.fromEntries(
      picks.spreadsheets.flatMap((s) =>
        s.tabs.map((tab) => [
          tabKey(s.id, tab.sheetId),
          mappedColumns(tab).map(([field]) => field),
        ]),
      ),
    ),
  };
}

// The rows Oriel may change, by ID, each with its spreadsheet and tab: rows
// of a mapped tab, in a spreadsheet the person can edit.
function writableRows(
  records: readonly IndexRecord[],
  context: NonNullable<SheetsContext>,
): Map<string, { spreadsheet: string; sheetId: number; fields: readonly FieldName[] }> {
  const editable = new Set(
    records.flatMap((record) => {
      const attrs = sheetsAttrsOf(record);
      return attrs?.of === "spreadsheet" && attrs.canEdit ? [attrs.spreadsheet.id] : [];
    }),
  );
  return new Map(
    records.flatMap((record) => {
      const attrs = sheetsAttrsOf(record);
      if (attrs?.of !== "row" || !editable.has(attrs.spreadsheet.id)) return [];
      const fields = context.tabs[tabKey(attrs.spreadsheet.id, attrs.tab.sheetId)];
      if (!fields) return [];
      return [
        [record.id, { spreadsheet: attrs.spreadsheet.id, sheetId: attrs.tab.sheetId, fields }],
      ];
    }),
  );
}

// The fields a write may set, as the agent writes them.
const fieldType = editableFields.map((f) => JSON.stringify(f)).join(" | ");
const text = refine(
  string,
  (value) => [...value].length <= maxText,
  `expected at most ${maxText} characters`,
);
const finite = refine(number, Number.isFinite, "expected a finite number");

export function sheetsNamespace(
  records: readonly IndexRecord[],
  context: SheetsContext,
): NamespaceSpec {
  const rows = context === undefined ? new Map() : writableRows(records, context);
  const inRegion = (ids: readonly ItemId[]) => ids.filter((id) => rows.has(id));
  const row = (id: string, has: (id: string) => boolean) => {
    const found = rows.get(id);
    if (!has(id) || !found)
      throw new RangeError(
        `${JSON.stringify(id)} isn't a row Oriel may change in this region; use a SheetsRowId`,
      );
    return found;
  };
  return {
    name: "Google Sheets",
    ops: sheetsOps,
    types: (scope) => {
      const ids = inRegion(scope.ids);
      if (!ids.length) return [];
      return [
        "/** This region's spreadsheet rows Oriel may change. */",
        ...idUnion("SheetsRowId", ids),
      ];
    },
    fns(scope): NamespaceFn[] {
      if (!inRegion(scope.ids).length) return [];
      return [
        write({
          name: "setField",
          doc: "Set the cell its tab maps to the field, as a value, never a formula; null empties it.",
          op: "setField",
          creates: false,
          params: [
            param("id", "SheetsRowId", string),
            param("field", fieldType, union(...editableFields.map((f) => literal(f)))),
            param("value", "string | number | null", nullable(union(text, finite))),
          ],
          build: ([id, field, value], host) => {
            const { fields } = row(id, (each) => host.has(each));
            if (!fields.includes(field))
              throw new RangeError(`${JSON.stringify(id)}'s tab maps no ${field} column`);
            return {
              target: id as ItemId<"sheets">,
              args: { field: field as EditableField, value },
            };
          },
        }),
        write({
          name: "addRow",
          doc: "Add a row after the last of `nextTo`'s tab; its key must be new there.",
          op: "addRow",
          creates: false,
          params: [
            param("nextTo", "SheetsRowId", string),
            param(
              "row",
              "{ key: string; title: string; status?: string; assignee?: string; estimate?: number; link?: string }",
              object({
                key: text,
                title: text,
                status: optional(text),
                assignee: optional(text),
                estimate: optional(finite),
                link: optional(text),
              }),
            ),
          ],
          build: ([nextTo, values], host) => {
            const { spreadsheet, sheetId, fields } = row(nextTo, (each) => host.has(each));
            const unmapped = Object.keys(values).find(
              (f) =>
                values[f as keyof typeof values] !== undefined && !fields.includes(f as FieldName),
            );
            if (unmapped !== undefined)
              throw new RangeError(`${JSON.stringify(nextTo)}'s tab maps no ${unmapped} column`);
            const given = Object.fromEntries(
              Object.entries(values).filter(([, v]) => v !== undefined),
            );
            return { target: null, args: { spreadsheet, sheetId, values: given } };
          },
        }),
      ];
    },
  };
}
