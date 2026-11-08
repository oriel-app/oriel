# standin-mcp

Stand-ins for the MCP servers Oriel reads sources through (decision 0059), over stdio, one per argument. They let Oriel's support for a source server be built and tried with no account at its vendor. Each reports the real server's name and tool names and answers with the real shapes, from a fixture world in memory. Private: never published, never bundled into the app.

```sh
node packages/standin-mcp/src/main.ts <atlassian|slack|linear> [--journal <file>]
```

It speaks MCP 2025-06-18 (`initialize`) and 2026-07-28 (`server/discover`), as `packages/sheets-mcp` does.

## atlassian

Stands in for Atlassian's Rovo MCP server. It answers from SYN (`fixtures/jira`, after its edits) in memory, through Jira's memory site (`@oriel/jira/testing`). Its tools live in `packages/jira/src/atlassian-standin.ts`, so Jira's tests run them in memory too.

Writes change only the process's own copy. With `--journal <file>`, every process given the same file shares its writes: a sync's process sees what a replay's process wrote.

Its shapes are the real server's, as `fixtures/jira-mcp/real-sync.json` and `real-read.json` recorded them (Claude Code 2.1.319 and Codex, 2026-11-08), at the address Atlassian's own instructions give, `https://mcp.atlassian.com/v2/mcp`:

- It reports `atlassian-mcp-server`, and lists a few Jira tools flat: `getAccessibleAtlassianResources`, `searchJiraIssuesUsingJql`, `getJiraIssue`, `listJiraIssueComments`, `createJiraIssue`, `editJiraIssue`, `transitionJiraIssue`, `addOrEditJiraIssueComment`, with `discover`, `executeRead`, `executeWrite` and `executeDestructive`.
- The rest run by name through `executeRead` or `executeWrite` (`{ cloudId, name, inputs }`), as `discover` names them. Oriel runs `listJiraIssueRemoteIssueLinks`, `listJiraBoards`, `getJiraBoardConfig`, `listJiraProjectIssueTypesMetadata`, `listJiraIssueTransitions`, `getJiraCurrentUser` and `listJiraProjects` through `executeRead`, and `createJiraIssueRemoteIssueLink` through `executeWrite`, from fixed lists. It never loads `executeDestructive`.
- Every answer is JSON in a text block, under `data`. Reads ask for `view: "full"`: the default view leaves out fields Oriel asks for, such as `parent` and `description`. Rich text comes as Markdown, and custom fields under `fields.customFields`, by their labels, each `{ id, value }`. A failure is `{ "error": true, "message", "statusCode" }`, with `isError`.
- The search and `getJiraIssue` also carry structured content on Codex, in another shape (`issues.nodes`), which Claude Code doesn't pass on. Oriel reads the text alone.
- Writes take Markdown: `createJiraIssue` (`projectKey`, `issueType` by name, `summary`, `description`, `contentFormat: "markdown"`, `parent`, `additional_fields`), `editJiraIssue` (`fields`), `transitionJiraIssue` (`transitionId`), `addOrEditJiraIssueComment` (`commentBody`). Their answers weren't recorded: Oriel's Jira proof reads only, as OA is the maintainer's backlog. One thing is known: `addOrEditJiraIssueComment`'s answer gives no comment ID Oriel can read (three out of three on OA, 2026-11-08), so the stand-in answers without one, and Oriel finds the new comment among the issue's (`listJiraIssueComments`): the one with the approved text that wasn't there before.
- A status move is checked against the item's workflow before it's approved, through `listJiraIssueTransitions`: the diff says when the move isn't allowed, and approving waits until it's left out.
- No operation deletes an issue, a comment or a link, so Revert can't undo a create, a comment or a link through the server: it says so and sends nothing.

Jira's parser (`packages/jira/src/atlassian.ts`) fails closed on anything else: the sync stops, names the server, and leaves the index as it was.

## slack

Stands in for Slack's MCP server, at `https://mcp.slack.com/mcp` (Streamable HTTP; its default 19 tools, Oriel's among them, are listed there, and more need more scopes, not another address). It reports `Slack MCP`, as the real one does. It answers from Ferrowick (`fixtures/slack`) in memory, through Slack's fixture Web API (`@oriel/slack`'s `fixtureApi`). It reads as the fixture's first person, who is in the fixture's picked channel and no other. Its tools live in `packages/slack/src/slack-standin.ts`.

Its shapes are the real server's, as `fixtures/slack-mcp/real-sync.json` and `real-read.json` recorded them through Claude Code 2.1.319: each tool answers with Markdown meant for a model, as a string under a key of a JSON object in a text block, with no structured content. No tool offers a structured format; the read tools offer only `response_format: detailed | concise`, and Oriel reads the default, `detailed`, which alone gives each message's `ts`.

| Tool                       | Arguments Oriel sends                                  | Answer                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slack_read_user_profile`  | `user_id`, the person's own when absent                | `{ result }`: "User ID: U0…", "Display Name:", "Real Name:" lines, and others; no workspace address or team ID                                                                                                                               |
| `slack_list_user_channels` | `types: "public_channel"`, `limit`, `cursor`           | `{ result }`: "## My Channels (showing N of M total)", then "### #name" with "- **ID:**", "- **Type:**", "- **Purpose:**", "- **Archived:**"; a further page as `Use cursor: "…"`                                                            |
| `slack_search_channels`    | `keywords: [name]`, `natural_language_query: ""`       | `{ results, pagination_info }`: "## Channels (N results)", each "### Result i of N" with "Name: #…" and "Permalink: [link](https://<workspace>.slack.com/archives/C0…)", the only place the workspace's address is given                     |
| `slack_read_channel`       | `channel_id`, `limit` (1–100), `cursor`                | `{ messages, pagination_info }`: "Channel: #name (C0…)", then each message, newest first, as "=== Message from Name <email> (U0…) at 2026-10-31 13:39:04 PDT ===", "Message TS: …", its text, and "Thread: N replies (latest: …)"            |
| `slack_read_thread`        | `channel_id`, `message_ts`, `limit` (1–1000), `cursor` | `{ messages, pagination_info }`: "=== THREAD PARENT MESSAGE ===", "=== THREAD REPLIES (N total) ===", and "--- Reply i of N ---" each, with "From:", "Time:" and "Message TS:" lines; a page is the latest replies, and its cursor goes back |
| `slack_send_message`       | `channel_id`, `message` (Markdown), `thread_ts`        | JSON: `{ message_link, message_context: { message_ts, channel_id } }`, read only for the channel posted to; Slack adds "_Sent using_ Claude" to the post                                                                                     |

A failure is "execution_failed: <Slack's code>", with `isError`. Slack's own "has joined the channel" posts come as messages; Oriel reads them as the Web API's `channel_join`, which isn't anyone's message. The workspace's address comes from the first channel the person is in, as the search links it; a picked public channel they aren't in is found by its exact name through the search, in that workspace.

Message text is the source's and may hold a line like a header. Slack's parser (`packages/slack/src/slack-answers.ts`) checks what the answers give to check by: a channel list and a thread count what they list, and each message's time must be its `ts`'s, the `ts`s in order. Anything it doesn't recognise stops the sync, names the server, and keeps the index. A post's text goes to `slack_send_message` with every mark escaped with a backslash, so it posts as the plain text the person approved. No tool deletes a message, so Revert can't undo a post or a reply through the server: it says so and sends nothing.

## linear

Stands in for Linear's MCP server, at `https://mcp.linear.app/mcp` (Streamable HTTP). What it reports in its handshake isn't documented, so Oriel knows it by its address alone; its read-only address, `/mcp/readonly`, has no write tools, so Oriel doesn't take it for this one. It answers from Ferrowick's Linear (`fixtures/linear`) in memory: two teams, ENG and OPS, each with its statuses, cycles, projects and issues. Its tools live in `packages/linear/src/linear-standin.ts`, so Linear's tests run them in memory too.

Linear documents its server's address and how to add it to an agent ([MCP](https://linear.app/docs/mcp)), not its tools. Their names and arguments are from the server's own tool list as third-party listings show it; their answers aren't shown anywhere. Here:

| Tool                  | Assumed until re-recorded                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_teams`          | `limit`, `after`; JSON of `{ teams: [{ id, key, name }], pageInfo: { hasNextPage, endCursor } }`                                                                                                                                         |
| `list_issue_statuses` | `team`; `{ statuses: [{ id, name, type }] }`, `type` one of Linear's (`backlog`, `unstarted`, `started`, `completed`, `canceled`, `triage`)                                                                                              |
| `list_cycles`         | `teamId`, `type`; `{ cycles: [{ id, number, name, startsAt, endsAt }] }`                                                                                                                                                                 |
| `list_users`          | `query`; `{ users: [{ id, name or displayName, active or isActive }] }`                                                                                                                                                                  |
| `list_projects`       | `teamId`, `limit`, `after`; `{ projects: [{ id, slugId, name, description or summary, status, lead, targetDate, url, updatedAt }], pageInfo }`, a status as a name or `{ name, type }`                                                   |
| `get_project`         | `query`; the project, bare or under `project`                                                                                                                                                                                            |
| `list_issues`         | `team`, `orderBy`, `limit`, `after`; `{ issues: [{ id, identifier, title, description, state, assignee, project, cycle, parent, estimate, labels, url, updatedAt }], pageInfo }`, each link as an object with its `id` or as `<field>Id` |
| `get_issue`           | `id`, `includeRelations`; the issue, bare or under `issue`                                                                                                                                                                               |
| `save_issue`          | with `id` it updates, without it creates: `team`, `title`, `description`, `assignee`, `state`, `project`, `cycle`, `estimate`, `labels`, `parentId`; answers the issue saved                                                             |
| `save_project`        | with `id` it updates, without it creates: `name`, `description`, `addTeams` or `setTeams`, `lead`, `targetDate`; answers the project saved                                                                                               |

A list comes bare or under its name, and a page that doesn't say whether more remain is followed by the one after its last item while it was full. No tool deletes an issue or a project, so Revert can't undo a create through the server: the change set offers none. Linear's parser (`packages/linear/src/linear-mcp.ts`) fails closed on anything else it can't read: the sync stops, names the server, and leaves the index as it was. A connection reads one team, the one picked in Settings or the first run, else the first `list_teams` gives.

## In dev

```sh
ORIEL_DEV_STANDINS=atlassian,slack,linear pnpm dev
```

Every process of your agent that Oriel starts gets each stand-in, as `atlassian-standin`, `slack-standin` or `linear-standin`, on its own command line (Claude Code's `--mcp-config`, Codex's `-c mcp_servers.…`), never in your configuration. The connector's entry for the real server knows it at its command. Turn Jira, Slack or Linear on through it in Settings › Source servers. The desktop app never reads this variable.

`node scripts/try-source-server.ts <codex|claude-code> [jira|slack|linear|sheets]` does the same end to end, with the index in memory: it finds the stand-in through your agent, turns the kind on, syncs its fixture, and approves one change set, which replays through the stand-in's write tools. It prints how long each step took.

## Re-recording from Atlassian's own server

`fixtures/jira-mcp/real-*.json` are recorded from Atlassian's server; `sync.json` and `read.json`, from this stand-in, which the tests compare with the fixture. To re-record:

1. Add Atlassian's server to your Codex or Claude Code, at `https://mcp.atlassian.com/v2/mcp`, and sign in to it, as [Atlassian's instructions](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/) say, as the account of our test site. Oriel never does this for you.
2. `node scripts/record-source-mcp.ts jira --through codex --server <its name>` (or `--through claude-code`). It reads SYN only, with only the server's read tools. People become numbered placeholders, times move to UTC, and the site's cloud ID becomes the stand-in's.
3. `pnpm --filter @oriel/jira check`. A test that fails names the tool whose answer changed: fix the parser in `packages/jira/src/atlassian.ts`, this stand-in to match, and record it again with `node scripts/record-source-mcp.ts jira`.
4. Propose what changed for approval: fixtures need the maintainer's.

## Re-recording from Slack's own server

`fixtures/slack-mcp/real-*.json` are recorded from Slack's server; `sync.json` and `read.json`, from this stand-in. To re-record:

1. Add Slack's server to your Claude Code or Codex, at `https://mcp.slack.com/mcp`, and sign in to it as [Slack's instructions](https://docs.slack.dev/ai/slack-mcp-server/) say, as a person in our test workspace. Oriel never does this for you.
2. `node scripts/record-source-mcp.ts slack --through claude-code --server <its name> --channels <a channel>`. It reads only, with only the server's read tools. People's IDs, names and emails become placeholders, wherever the Markdown gives them, and the workspace's address `https://oriel-test.slack.com`. Read the recording before proposing it: a name the answers don't pair with an ID isn't caught.
3. `pnpm --filter @oriel/slack check`, then fix the readers in `packages/slack/src/slack-answers.ts` and this stand-in to match, and record the stand-in again with `node scripts/record-source-mcp.ts slack`.
4. Propose what changed for approval: fixtures need the maintainer's.

## Re-recording from Linear's own server

`fixtures/linear-mcp/` is recorded from this stand-in until it's recorded from Linear's server. To re-record:

1. Add Linear's server to your Codex, at `https://mcp.linear.app/mcp`, and sign in to it as [Linear's instructions](https://linear.app/docs/mcp) say, as a member of our test workspace, never anyone's real one. Oriel never does this for you.
2. `node scripts/record-source-mcp.ts linear --through codex --server <its name in your Codex>`. It reads only, through Codex's `mcpServer/tool/call`, with no model, with only the server's read tools, on the first team it lists. People become numbered placeholders and the workspace's address `https://linear.app/oriel-test`.
3. `pnpm --filter @oriel/linear check`. A test that fails names the tool whose arguments or answer differ from what's assumed above; fix the parser in `packages/linear/src/linear-mcp.ts`, and this stand-in to match.
4. Propose what changed for approval: fixtures need the maintainer's.
