// The read side only. The writer is exported from `@oriel/slack/writer`, and
// nothing here imports it.
export {
  bearer,
  readMethods,
  type ReadMethod,
  type SlackApi,
  SlackError,
  webApi,
  type WebApiOptions,
} from "./api.ts";
export {
  type SlackAttrs,
  slackAttrs,
  slackAttrsOf,
  type SlackContent,
  slackContent,
  slackDetails,
  slackLinked,
  slackFacets,
  type SlackPerson,
  slackPresentation,
  type SlackRecord,
  slackText,
  slackTitle,
} from "./attrs.ts";
export { connectSlack, slackPerson, type SlackWorkspace } from "./connect.ts";
export { slackDeclaration } from "./declaration.ts";
export { escapeText, isSlackOp, type SlackArgs, type SlackOp, slackOps } from "./ops.ts";
export { type SlackContext, slackNamespace } from "./namespace.ts";
export { slackSpecs } from "./specs.ts";
export {
  type FixtureApiOptions,
  type FixtureCall,
  type FixtureMessage,
  type FixtureWorkspace,
  fixtureApi,
  fixtureApiOrigin,
  parseSlackFixture,
  type SlackFixture,
} from "./fixture.ts";
export { mentionedUsers, plainText } from "./mrkdwn.ts";
export {
  maxChannels,
  maxMessagesPerChannel,
  maxReplies,
  permalink,
  slackKey,
  type SlackSource,
  type SlackSourceOptions,
  slackSource,
  tsInstant,
} from "./source.ts";
