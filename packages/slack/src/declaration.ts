// Slack as it declares itself to the composition root: writable through
// approved change sets (OA-28), so it has a namespace and op specs.
import type { SourceDeclaration } from "@oriel/core";
import { slackAttrsOf, slackPanel, slackPresentation } from "./attrs.ts";
import { type SlackContext, slackItemDoc, slackNamespace } from "./namespace.ts";
import { type SlackScope, slackRecognizer } from "./references.ts";
import { slackSpecs } from "./specs.ts";

export const slackDeclaration = {
  ...slackPresentation,
  itemDoc: slackItemDoc,
  panel: slackPanel,
  // How many replies its conversation has, the one thing a sync can tell
  // moved in a message besides its text.
  recognizer: slackRecognizer,
  facets: { replies: { label: "Replies", of: (record) => slackAttrsOf(record)?.replies ?? null } },
  namespace: (_records, context: SlackContext) => slackNamespace(context),
  specs: slackSpecs,
} satisfies SourceDeclaration<SlackContext, SlackScope>;
