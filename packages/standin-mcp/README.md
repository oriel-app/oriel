# standin-mcp

Stand-ins for the MCP servers Oriel reads sources through (decision 0059), over stdio, one per argument. They let Oriel's support for a source server be built and tried with no account at its vendor. Each reports the real server's name and tool names and answers with the real shapes, from a fixture world in memory. Private: never published, never bundled into the app.

```sh
node packages/standin-mcp/src/main.ts <atlassian|slack> [--journal <file>]
```

It speaks MCP 2025-06-18 (`initialize`) and 2026-07-28 (`server/discover`), as `packages/sheets-mcp` does.

## atlassian

Stands in for Atlassian's Rovo MCP server. It answers from SYN (`fixtures/jira`, after its edits) in memory, through Jira's memory site (`@oriel/jira/testing`). Its tools live in `packages/jira/src/atlassian-standin.ts`, so Jira's tests run them in memory too.

Writes change only the process's own copy. With `--journal <file>`, every process given the same file shares its writes: a sync's process sees what a replay's process wrote.

Atlassian documents its tools' names and what each does, not their arguments or answers ([supported tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/)). Here:

| Tool                                                                                                                                                                                                                        | Documented                                                                                       | Assumed until re-recorded                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAccessibleAtlassianResources`                                                                                                                                                                                           | name; gives each site's `cloudId`                                                                | a list of `{ id, url, name, scopes }`                                                                                                                                             |
| `searchJiraIssuesUsingJql`                                                                                                                                                                                                  | name; `cloudId`, `jql`, `fields`, `maxResults`, `nextPageToken` (from Atlassian's issue tracker) | answers `{ issues: { nodes, pageInfo: { hasNextPage, endCursor }, totalCount, remainingCount } }`, each node REST's issue; REST's `{ issues, nextPageToken, isLast }` is read too |
| `getJiraIssue`, `listJiraIssueComments`, `listJiraIssueRemoteIssueLinks`, `listJiraIssueTransitions`, `listJiraBoards`, `getJiraBoardConfig`, `listJiraProjectIssueTypesMetadata`, `getJiraCurrentUser`, `listJiraProjects` | names                                                                                            | the REST call each wraps, by its path's names (`issueIdOrKey`, `boardId`, `projectIdOrKey`), answering REST's body                                                                |
| `createJiraIssue`                                                                                                                                                                                                           | name                                                                                             | `projectKey`, `issueTypeName`, `summary`, `description` with `contentFormat: "adf"`, `parent` (a key), `additional_fields`                                                        |
| `editJiraIssue`                                                                                                                                                                                                             | name                                                                                             | `issueIdOrKey`, REST's `fields`, an assignee as `{ accountId }`                                                                                                                   |
| `transitionJiraIssue`                                                                                                                                                                                                       | name                                                                                             | `issueIdOrKey`, `transition: { id }`                                                                                                                                              |
| `addOrEditJiraIssueComment`                                                                                                                                                                                                 | name                                                                                             | `issueIdOrKey`, `commentBody` (ADF), `contentFormat: "adf"`                                                                                                                       |
| `createJiraIssueRemoteIssueLink`                                                                                                                                                                                            | name                                                                                             | `issueIdOrKey`, `url`, `title`                                                                                                                                                    |
| `deleteJiraIssue`, `deleteJiraComment`                                                                                                                                                                                      | names; off unless an admin turns them on                                                         | `issueIdOrKey`, `commentId`                                                                                                                                                       |

Every call names `cloudId`. Atlassian's v2 lists its other tools flat only at `https://mcp.atlassian.com/v2/mcp?tools=all`; at the plain address, only its primary tools are listed, and Oriel doesn't recognise it. No tool removes a remote link, so Revert can't undo an added link through the server. Jira's parser (`packages/jira/src/atlassian.ts`) reads what it can't be sure of tolerantly, and fails closed on anything else: the sync stops, names the server, and leaves the index as it was.

## slack

Stands in for Slack's MCP server, at `https://mcp.slack.com/mcp` (Streamable HTTP; its default 19 tools, Oriel's among them, are listed there, and more need more scopes, not another address). It reports `Slack MCP`, as the real one does. It answers from Ferrowick (`fixtures/slack`) in memory, through Slack's fixture Web API (`@oriel/slack`'s `fixtureApi`). It reads as the fixture's first person, who is in the fixture's picked channel and no other. Its tools live in `packages/slack/src/slack-standin.ts`.

Slack documents its tools' names and arguments ([overview](https://docs.slack.dev/ai/slack-mcp-server/)), not their answers. Here:

| Tool                       | Documented                                                                                                                                         | Assumed until re-recorded                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slack_read_user_profile`  | name; `user_id`, the person's own when absent                                                                                                      | JSON of `{ user_id, team_id, workspace_url, profile: { real_name, display_name } }`; the profile under `user`, or flat, and the address as `team_url` or `url`, are read too |
| `slack_list_user_channels` | name; filters by type, pages                                                                                                                       | `channel_types`, `limit`, `cursor`; JSON of `{ channels: [{ id, name, is_archived }], response_metadata: { next_cursor } }`, or `next_cursor` beside them                    |
| `slack_read_channel`       | name; `channel_id`, `limit` (1–100), `cursor`, `oldest`, `latest`; newest first                                                                    | JSON of `conversations.history`'s body: `messages`, each a Web API message, `has_more`, `response_metadata.next_cursor`                                                      |
| `slack_read_thread`        | name; `channel_id`, `message_ts`, `limit` (1–1000), `cursor`, `oldest`, `latest`                                                                   | JSON of `conversations.replies`'s body, the same way                                                                                                                         |
| `slack_send_message`       | name; `channel_id`, `message` (markdown), `thread_ts`, `reply_broadcast`; answers `message_link` and `message_context: { message_ts, channel_id }` | a failure names Slack's error code in its text                                                                                                                               |

A message's `message_ts` and `user_id` are read as `ts` and `user`. A post's text goes to `slack_send_message` with every mark that would make formatting, a link or a mention escaped with a backslash, so it posts as the plain text the person approved, as the Web API's `mrkdwn: false` did; the stand-in reads it back as plain text. Check on re-recording that Slack's server honours a backslash escape. No tool deletes a message, so Revert can't undo a post or a reply through the server: it says so and sends nothing. A third-party write-up says Slack's search answers in markdown for a model to read; if the read tools answer that way too, the parser stops the sync, names the server and keeps the index, and needs a reader for it.

## In dev

```sh
ORIEL_DEV_STANDINS=atlassian,slack pnpm dev
```

Every process of your agent that Oriel starts gets each stand-in, as `atlassian-standin` or `slack-standin`, on its own command line (Claude Code's `--mcp-config`, Codex's `-c mcp_servers.…`), never in your configuration. The connector's entry for the real server knows it at its command. Turn Jira or Slack on through it in Settings › Source servers. The desktop app never reads this variable.

`node scripts/try-source-server.ts <codex|claude-code> [jira|slack]` does the same end to end, with the index in memory: it finds the stand-in through your agent, turns the kind on, syncs its fixture, and approves one change set, which replays through the stand-in's write tools. On Claude Code it spends a little of your plan on Haiku, and prints how long each step took.

## Re-recording from Atlassian's own server

`fixtures/jira-mcp/` is recorded from this stand-in until it's recorded from Atlassian's server. To re-record:

1. Add Atlassian's server to your Codex, at `https://mcp.atlassian.com/v2/mcp?tools=all`, and sign in to it, as [Atlassian's instructions](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/) say, as the account of our test site, never a person's. Oriel never does this for you.
2. `node scripts/record-source-mcp.ts jira --through codex --server <its name in your Codex>`. It reads only: through Codex's `mcpServer/tool/call`, with no model, with only the server's read tools. People become numbered placeholders and times move to UTC.
3. `pnpm --filter @oriel/jira check`. A test that fails names the tool whose arguments or answer differ from what's assumed above; fix the parser in `packages/jira/src/atlassian.ts`, and this stand-in to match.
4. Check the recordings' `recorded` line, and propose them for approval: fixtures need the maintainer's.

## Re-recording from Slack's own server

`fixtures/slack-mcp/` is recorded from this stand-in until it's recorded from Slack's server. To re-record:

1. Add Slack's server to your Codex, at `https://mcp.slack.com/mcp`, and sign in to it as [Slack's instructions](https://docs.slack.dev/ai/slack-mcp-server/) say, as a person in our test workspace, never in anyone's real one. Oriel never does this for you.
2. `node scripts/record-source-mcp.ts slack --through codex --server <its name in your Codex> --channels <a channel you're in>`. It reads only, through Codex's `mcpServer/tool/call`, with no model, with only the server's read tools. People's IDs and names become numbered placeholders, and the workspace's address `https://oriel-test.slack.com`.
3. `pnpm --filter @oriel/slack check`. The recordings won't match Ferrowick, so the tests that compare them with the fixture fail: read each tool's answer, fix the parser in `packages/slack/src/slack-mcp.ts` and this stand-in to match, then record the stand-in again with `node scripts/record-source-mcp.ts slack`.
4. Propose what changed for approval: fixtures need the maintainer's.
