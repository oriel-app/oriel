// Google Sheets as it declares itself to the composition root (decision
// 0050): writable through approved change sets, values only, so it has a
// namespace and op specs.
import type { SourceDeclaration } from "@oriel/core";
import {
  sheetsAttrsOf,
  sheetsItemDoc,
  sheetsKeyShape,
  sheetsPanel,
  sheetsPresentation,
} from "./attrs.ts";
import { sheetsOffer, sheetsReads } from "./connecting.ts";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { sheetsOptions } from "./mapping.ts";
import { type SheetsContext, sheetsNamespace } from "./namespace.ts";
import { openSheets, type SheetsWrites } from "./open-connection.ts";
import { sheetsOverview } from "./overview.ts";
import { sheetsPreview, sheetsReview } from "./preview.ts";
import { sheetsServer } from "./sheets-mcp.ts";
import { sheetsSpecs } from "./specs.ts";

export const sheetsDeclaration = {
  kind: "sheets",
  key: sheetsKeyShape,
  ...sheetsPresentation,
  itemDoc: sheetsItemDoc,
  panel: sheetsPanel,
  // A row's status as the cell says it, which moves even where it means no
  // state, as a RAG column's does, and its estimate, where its tab maps one.
  facets: {
    estimate: { label: "Estimate", of: (record) => record.facets.estimate ?? null },
    status: {
      label: "Status",
      of: (record) => {
        const attrs = sheetsAttrsOf(record);
        return attrs?.of === "row" ? attrs.status : null;
      },
    },
  },
  // Nothing names a row or a spreadsheet by its key, a hash.
  recognizer: () => () => [],
  overview: sheetsOverview,
  namespace: sheetsNamespace,
  specs: sheetsSpecs,
  // Its item doc, and, in a region holding a row Oriel may change,
  // setField and addRow (OA-223): 835 bytes.
  budget: 900,
  open: openSheets,
  // The spreadsheets the person picked, each tab's mapping, which Settings
  // draws with its review step, and whether it is read-only.
  options: sheetsOptions,
  optionFields: [
    {
      kind: "mapping",
      name: "spreadsheets",
      label: "How Oriel reads each tab",
      about:
        "Oriel turns each row into an item. Choose which columns give each item its title, status and other fields.",
    },
    { kind: "read-only", name: "readOnly" },
  ],
  // Each picked tab's first rows, which the agent drafts a mapping from,
  // naming columns by letter, and Oriel's own guess (decision 0051).
  preview: sheetsPreview,
  review: sheetsReview,
  offer: sheetsOffer,
  reads: sheetsReads,
  // Through Oriel's own Sheets server, in the person's agent (decision
  // 0059), where a person picks the spreadsheets.
  servers: [sheetsServer],
  fixture: sheetsDeclaredFixture,
} satisfies SourceDeclaration<SheetsContext, never, SheetsWrites>;
