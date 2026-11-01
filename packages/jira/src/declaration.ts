// Jira as it declares itself to the composition root.
import type { SourceDeclaration } from "@oriel/core";
import { jiraPresentation } from "./attrs.ts";
import { type Estimates, jiraItemDoc, jiraNamespace } from "./namespace.ts";
import { jiraSpecs } from "./specs.ts";

export const jiraDeclaration = {
  ...jiraPresentation,
  itemDoc: jiraItemDoc,
  namespace: (records, estimates: Estimates) =>
    jiraNamespace(new Map(records.map((record) => [record.id, record.facets.kind])), estimates),
  specs: jiraSpecs,
} satisfies SourceDeclaration<Estimates>;
