// Slack, read-only (decision 0021). It has no writer and no op catalogue.
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
  slackFacets,
  type SlackPerson,
  slackPresentation,
  type SlackRecord,
  slackText,
  slackTitle,
} from "./attrs.ts";
export { connectSlack, type SlackWorkspace } from "./connect.ts";
export {
  type FixtureApiOptions,
  type FixtureCall,
  type FixtureMessage,
  fixtureApi,
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
