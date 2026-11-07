# standin-mcp

Stand-ins for the MCP servers Oriel reads sources through (decision 0059), over stdio, one per argument. They let Oriel's support for a source server be built and tried with no account at its vendor. Each reports the real server's name and tool names and answers with the real shapes, from a fixture world in memory. Private: never published, never bundled into the app.

```sh
node packages/standin-mcp/src/main.ts atlassian [--journal <file>]
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

## In dev

```sh
ORIEL_DEV_STANDINS=atlassian pnpm dev
```

Every process of your agent that Oriel starts gets the stand-in, as `atlassian-standin`, on its own command line (Claude Code's `--mcp-config`, Codex's `-c mcp_servers.…`), never in your configuration. Jira's entry for Atlassian's server knows it at its command. Turn Jira on through it in Settings › Source servers. The desktop app never reads this variable.

`node scripts/try-source-server.ts <codex|claude-code>` does the same end to end, with the index in memory: it finds the stand-in through your agent, turns Jira on, syncs SYN, and approves one change set, which replays through the stand-in's write tools. On Claude Code it spends a little of your plan on Haiku, and prints how long each step took.

## Re-recording from Atlassian's own server

`fixtures/jira-mcp/` is recorded from this stand-in until it's recorded from Atlassian's server. To re-record:

1. Add Atlassian's server to your Codex, at `https://mcp.atlassian.com/v2/mcp?tools=all`, and sign in to it, as [Atlassian's instructions](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/) say, as the account of our test site, never a person's. Oriel never does this for you.
2. `node scripts/record-jira-mcp.ts --through codex --server <its name in your Codex>`. It reads only: through Codex's `mcpServer/tool/call`, with no model, with only the server's read tools. People become numbered placeholders and times move to UTC.
3. `pnpm --filter @oriel/jira check`. A test that fails names the tool whose arguments or answer differ from what's assumed above; fix the parser in `packages/jira/src/atlassian.ts`, and this stand-in to match.
4. Check the recordings' `recorded` line, and propose them for approval: fixtures need the maintainer's.
