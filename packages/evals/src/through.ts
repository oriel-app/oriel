// A fixture connected through its kind's source server (decision 0059,
// OA-276, OA-277), as a case asks with `servers`: a stand-in of the server answers
// in memory, from the fixture after the case's edits, and the connector's
// own parser syncs and reads through it, as the app does. Its index must be
// the fixture's, item for item, or the case's world isn't the one its
// cassettes were recorded in.
import { type FixtureConnection, type ItemId, listed, type ToOpen } from "@oriel/core";
import { atlassianServer, frozenAt, loadJiraFixture, openJira } from "@oriel/jira";
import { atlassianStandIn, standInCaller } from "@oriel/jira/standin";
import { memorySite } from "@oriel/jira/testing";
import { loadSlackFixture, openSlack, slackServer } from "@oriel/slack";
import { slackStandIn, standInCaller as slackCaller } from "@oriel/slack/standin";

const connection: ToOpen = {
  id: "01JEVALSTHROUGHSERVER00000" as ToOpen["id"],
  number: 1,
  prefix: "jira",
  identity: "",
  options: { project: "SYN" },
  secret: null,
};

// Jira through Atlassian's server, a stand-in of it on SYN after `edited`
// edits, with what `connect` gives beside it: its context and its changes.
async function jira(edited: number, plain: FixtureConnection): Promise<FixtureConnection> {
  const fixture = loadJiraFixture();
  const site = memorySite({ ...fixture, edits: fixture.edits.slice(0, edited) }, frozenAt(fixture));
  const tools = standInCaller(atlassianStandIn(site));
  const opened = await openJira(connection, {
    kept: false,
    log: () => {},
    now: () => frozenAt(fixture),
    server: {
      known: atlassianServer,
      found: {
        name: "atlassian",
        status: "connected",
        reports: null,
        url: "https://mcp.atlassian.com/v2/mcp",
        command: null,
        tools: [...atlassianServer.reads, ...atlassianServer.writes],
      },
      read: tools,
      write: async () => {
        throw new Error("an eval's world writes nothing");
      },
    },
  });
  const { records, texts } = await listed(opened.source.sync(null));
  // In the fixture's order, as its own connection gives them.
  const order = new Map(plain.records.map((record, i) => [record.id, i]));
  return {
    ...plain,
    records: records.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    texts,
    read: (ids: readonly ItemId[]) => opened.source.read(ids as ItemId<"jira">[]),
  };
}

// Slack through Slack's server, a stand-in of it on Ferrowick, in the
// channels the fixture picked. Its fixture has no edits.
async function slack(_edited: number, plain: FixtureConnection): Promise<FixtureConnection> {
  const fixture = loadSlackFixture();
  const opened = await openSlack(
    {
      ...connection,
      prefix: "slack",
      identity: fixture.team.url,
      options: { channels: fixture.picked },
    },
    {
      kept: false,
      log: () => {},
      now: () => "2026-11-07T00:00:00.000Z" as never,
      server: {
        known: slackServer,
        found: {
          name: "slack",
          status: "connected",
          reports: slackServer.reports,
          url: "https://mcp.slack.com/mcp",
          command: null,
          tools: [...slackServer.reads, ...slackServer.writes],
        },
        read: slackCaller(slackStandIn(fixture)),
        write: async () => {
          throw new Error("an eval's world writes nothing");
        },
      },
    },
  );
  const { records, texts } = await listed(opened.source.sync(null));
  const order = new Map(plain.records.map((record, i) => [record.id, i]));
  return {
    ...plain,
    records: records.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
    texts,
    read: (ids: readonly ItemId[]) => opened.source.read(ids as ItemId<"slack">[]),
  };
}

// The kinds a case may have on through their source server, each as its
// stand-in connects it.
export const throughServers: Readonly<
  Record<string, (edited: number, plain: FixtureConnection) => Promise<FixtureConnection>>
> = { jira, slack };
