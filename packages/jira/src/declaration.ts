// Jira as it declares itself to the composition root.
import type { SourceDeclaration } from "@oriel/core";
import { jiraKeyShape, jiraPresentation } from "./attrs.ts";
import { type Estimates, jiraItemDoc, jiraNamespace } from "./namespace.ts";
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
  // Its estimate, in its board's points; null when not estimated yet, or on
  // a board that takes no estimates.
  recognizer: jiraRecognizer,
  facets: { estimate: { label: "Estimate", of: (record) => record.facets.estimate ?? null } },
  overview: jiraOverview,
  namespace: (records, estimates: Estimates) =>
    jiraNamespace(new Map(records.map((record) => [record.id, record.facets.kind])), estimates),
  specs: jiraSpecs,
} satisfies SourceDeclaration<Estimates, JiraScope>;
