// Jira as it declares itself to the composition root.
import type { SourceDeclaration } from "@oriel/core";
import { jiraDeclaredFacets, jiraKeyShape, jiraPresentation } from "./attrs.ts";
import { jiraConnect, jiraLive, jiraOptionFields, jiraOptions } from "./connecting.ts";
import { jiraDeclaredFixture } from "./declared-fixture.ts";
import { type Estimates, jiraItemDoc, jiraNamespace } from "./namespace.ts";
import { type JiraWrites, openJira } from "./open-connection.ts";
import { jiraOverview } from "./overview.ts";
import { jiraPanel } from "./panel.ts";
import { type JiraScope, jiraRecognizer } from "./references.ts";
import { jiraSpecs } from "./specs.ts";

export const jiraDeclaration = {
  kind: "jira",
  key: jiraKeyShape,
  ...jiraPresentation,
  itemDoc: jiraItemDoc,
  panel: jiraPanel,
  recognizer: jiraRecognizer,
  facets: jiraDeclaredFacets,
  overview: jiraOverview,
  // Unconnected, it has nowhere to create a story with no epic, and no
  // board's estimates to go by.
  namespace: (records, estimates: Estimates | undefined) =>
    jiraNamespace(
      new Map(records.map((record) => [record.id, record.facets.kind])),
      estimates ?? { none: new Set(), home: null },
    ),
  specs: jiraSpecs,
  // Its item doc and its namespace: the rules on estimates, epics and the
  // ops' arguments.
  budget: 3_200,
  open: openJira,
  options: jiraOptions,
  optionFields: jiraOptionFields,
  connect: jiraConnect,
  live: jiraLive,
  fixture: jiraDeclaredFixture,
} satisfies SourceDeclaration<Estimates | undefined, JiraScope, JiraWrites>;
