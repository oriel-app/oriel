import type { SourceDeclaration } from "@oriel/core";
import { folderItemDoc, folderKeyShape, folderPanel, folderPresentation } from "./attrs.ts";
import { folderConnect, folderOffer, folderOptions, folderReads } from "./connecting.ts";
import { folderDeclaredFixture } from "./declared-fixture.ts";
import { openFolder } from "./open-connection.ts";
import { folderOverview } from "./overview.ts";

export const folderDeclaration = {
  kind: "folder",
  key: folderKeyShape,
  ...folderPresentation,
  itemDoc: folderItemDoc,
  panel: folderPanel,
  facets: {},
  recognizer: () => () => [],
  overview: folderOverview,
  budget: 250,
  open: openFolder,
  options: folderOptions,
  offer: folderOffer,
  reads: folderReads,
  connect: folderConnect,
  fixture: folderDeclaredFixture,
} satisfies SourceDeclaration;
