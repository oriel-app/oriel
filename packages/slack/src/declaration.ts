import type { SourceDeclaration } from "@oriel/core";
import { slackAttrsOf, slackKeyShape, slackPanel, slackPresentation } from "./attrs.ts";
import { slackOptionFields, slackOptions } from "./connecting.ts";
import { slackDeclaredFixture } from "./declared-fixture.ts";
import { type SlackContext, slackItemDoc, slackNamespace } from "./namespace.ts";
import { openSlack, type SlackWrites } from "./open-connection.ts";
import { slackOverview } from "./overview.ts";
import { type SlackScope, slackRecognizer } from "./references.ts";
import { slackServer } from "./slack-mcp.ts";
import { slackSpecs } from "./specs.ts";

export const slackDeclaration = {
  kind: "slack",
  key: slackKeyShape,
  ...slackPresentation,
  itemDoc: slackItemDoc,
  panel: slackPanel,
  recognizer: slackRecognizer,
  facets: { replies: { label: "Replies", of: (record) => slackAttrsOf(record)?.replies ?? null } },
  overview: slackOverview,
  namespace: (_records, context: SlackContext) => slackNamespace(context),
  specs: slackSpecs,
  budget: 900,
  open: openSlack,
  options: slackOptions,
  optionFields: slackOptionFields,
  servers: [slackServer],
  fixture: slackDeclaredFixture,
} satisfies SourceDeclaration<SlackContext, SlackScope, SlackWrites>;
