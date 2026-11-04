// Google Sheets as it declares itself to the composition root (decision
// 0050): read-only for now, so it has no namespace and no op specs.
import type { SourceDeclaration } from "@oriel/core";
import {
  sheetsAttrsOf,
  sheetsItemDoc,
  sheetsKeyShape,
  sheetsPanel,
  sheetsPresentation,
} from "./attrs.ts";
import { sheetsDeclaredFixture } from "./declared-fixture.ts";
import { openSheets } from "./open-connection.ts";
import { sheetsPicks } from "./mapping.ts";
import { sheetsOverview } from "./overview.ts";

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
  // Its item doc only.
  budget: 300,
  open: openSheets,
  // The spreadsheets the person picked, and each tab's mapping.
  options: sheetsPicks,
  fixture: sheetsDeclaredFixture,
} satisfies SourceDeclaration;
