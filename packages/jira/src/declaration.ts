// Jira as it declares itself to the composition root.
import { issueDeclaredFacets, issueOverview, type SourceDeclaration } from "@oriel/core";
import { jiraKeyShape, jiraPresentation } from "./attrs.ts";
import { jiraConnect, jiraLive, jiraOptionFields, jiraOptions } from "./connecting.ts";
import { jiraDeclaredFixture } from "./declared-fixture.ts";
import { type Estimates, jiraItemDoc, jiraNamespace } from "./namespace.ts";
import { type JiraWrites, openJira } from "./open-connection.ts";
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
  // An issue tracker's, as every tracker's are (decision 0059).
  facets: issueDeclaredFacets,
  overview: issueOverview,
  // Unconnected, it has nowhere to create a story with no epic, and no
  // board's estimates to go by, so a region with no items yet gets none of
  // its creates: what it can't apply, the agent can't propose.
  namespace: (records, estimates: Estimates | undefined) => {
    const spec = jiraNamespace(
      new Map(records.map((record) => [record.id, record.facets.kind])),
      estimates ?? { none: new Set(), home: null },
    );
    return estimates === undefined ? { ...spec, blank: false } : spec;
  },
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
