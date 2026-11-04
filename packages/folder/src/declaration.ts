import type { SourceDeclaration } from "@oriel/core";
import { folderItemDoc, folderKeyShape, folderPanel, folderPresentation } from "./attrs.ts";
import { folderConnect, folderOptions } from "./connecting.ts";
import { folderDeclaredFixture } from "./declared-fixture.ts";
import { openFolder } from "./open-connection.ts";
import { folderOverview } from "./overview.ts";

// The folder as it declares itself to the composition root: read-only, so it
// has no namespace and no op specs.
export const folderDeclaration = {
  kind: "folder",
  key: folderKeyShape,
  ...folderPresentation,
  itemDoc: folderItemDoc,
  panel: folderPanel,
  // A file has no facet beyond its kind, which never changes.
  facets: {},
  // Nothing names a file by its key, a hash, so the folder recognizes none.
  recognizer: () => () => [],
  overview: folderOverview,
  // Its item doc only.
  budget: 250,
  open: openFolder,
  options: folderOptions,
  connect: folderConnect,
  fixture: folderDeclaredFixture,
} satisfies SourceDeclaration;
