// Slack as it declares itself to the composition root: writable through
// approved change sets (OA-28), so it has a namespace and op specs.
import type { SourceDeclaration } from "@oriel/core";
import { slackPanel, slackPresentation } from "./attrs.ts";
import { type SlackContext, slackItemDoc, slackNamespace } from "./namespace.ts";
import { slackSpecs } from "./specs.ts";

export const slackDeclaration = {
  ...slackPresentation,
  itemDoc: slackItemDoc,
  panel: slackPanel,
  namespace: (_records, context: SlackContext) => slackNamespace(context),
  specs: slackSpecs,
} satisfies SourceDeclaration<SlackContext>;
