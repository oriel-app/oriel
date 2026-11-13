import { issueDeclaredFacets, issueOverview, type SourceDeclaration } from "@oriel/core";
import { atlassianServer } from "./atlassian.ts";
import { jiraKeyShape, jiraPresentation } from "./attrs.ts";
import { jiraOffer, jiraOptionFields, jiraOptions, jiraReads } from "./connecting.ts";
import { jiraDeclaredFixture } from "./declared-fixture.ts";
import { type Estimates, jiraItemDoc, jiraNamespace } from "./namespace.ts";
import { type JiraWrites, openJira } from "./open-connection.ts";
import { jiraPanel } from "./panel.ts";
import { type JiraScope, jiraRecognizer } from "./references.ts";
import { jiraSpecs } from "./specs.ts";
import { takeIssues } from "./take-issues.ts";

export const jiraDeclaration = {
  kind: "jira",
  key: jiraKeyShape,
  ...jiraPresentation,
  itemDoc: jiraItemDoc,
  panel: jiraPanel,
  recognizer: jiraRecognizer,
  facets: issueDeclaredFacets,
  overview: issueOverview,
  // Unconnected, it has nowhere to create a story with no epic: what it can't apply, the agent can't propose.
  namespace: (records, estimates: Estimates | undefined) => {
    const spec = jiraNamespace(
      new Map(records.map((record) => [record.id, record.facets.kind])),
      estimates ?? { none: new Set(), home: null },
    );
    return estimates === undefined ? { ...spec, blank: false } : spec;
  },
  specs: jiraSpecs,
  budget: 3_200,
  open: openJira,
  options: jiraOptions,
  optionFields: jiraOptionFields,
  offer: jiraOffer,
  reads: jiraReads,
  servers: [atlassianServer],
  takeIssues,
  fixture: jiraDeclaredFixture,
} satisfies SourceDeclaration<Estimates | undefined, JiraScope, JiraWrites>;
