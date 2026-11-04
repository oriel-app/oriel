// Slack as it declares itself to the composition root: writable through
// approved change sets (OA-28), so it has a namespace and op specs.
import type { SourceDeclaration } from "@oriel/core";
import { slackAttrsOf, slackKeyShape, slackPanel, slackPresentation } from "./attrs.ts";
import { slackLive, slackOptions } from "./connecting.ts";
import { slackDeclaredFixture } from "./declared-fixture.ts";
import { type SlackContext, slackItemDoc, slackNamespace } from "./namespace.ts";
import { openSlack, type SlackWrites } from "./open-connection.ts";
import { slackOverview } from "./overview.ts";
import { type SlackScope, slackRecognizer } from "./references.ts";
import { slackSpecs } from "./specs.ts";

export const slackDeclaration = {
  kind: "slack",
  key: slackKeyShape,
  ...slackPresentation,
  itemDoc: slackItemDoc,
  panel: slackPanel,
  // How many replies its conversation has, the one thing a sync can tell
  // moved in a message besides its text.
  recognizer: slackRecognizer,
  facets: { replies: { label: "Replies", of: (record) => slackAttrsOf(record)?.replies ?? null } },
  overview: slackOverview,
  namespace: (_records, context: SlackContext) => slackNamespace(context),
  specs: slackSpecs,
  // Its item doc, and, connected, postMessage and reply (OA-28).
  budget: 900,
  open: openSlack,
  options: slackOptions,
  live: slackLive,
  fixture: slackDeclaredFixture,
} satisfies SourceDeclaration<SlackContext, SlackScope, SlackWrites>;
