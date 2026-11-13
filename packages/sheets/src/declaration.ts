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
  recognizer: () => () => [],
  overview: sheetsOverview,
  namespace: sheetsNamespace,
  specs: sheetsSpecs,
  budget: 900,
  open: openSheets,
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
  preview: sheetsPreview,
  review: sheetsReview,
  offer: sheetsOffer,
  reads: sheetsReads,
  servers: [sheetsServer],
  fixture: sheetsDeclaredFixture,
} satisfies SourceDeclaration<SheetsContext, never, SheetsWrites>;
