# sheets-mcp

A small MCP server for Google Sheets, over stdio. It lists your spreadsheets, reads their tabs, ranges and comments, and writes ranges and rows, as your own Google account. Add it to Claude Code, Codex or any other MCP client the way you'd add any stdio server.

It has no dependencies. Node 24 runs its TypeScript directly, from a checkout of this repo. It is private: never published, never bundled into anything else.

## Tools

| Tool                | Does                                                                                                                                                                                                                                                                                                                                                                                                                         | Annotations                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `list_spreadsheets` | Your spreadsheets, most recently changed first: ID, name, modified time, URL. An optional name filter (`query`), and paging (`pageSize`, `pageToken`).                                                                                                                                                                                                                                                                       | `readOnlyHint`                      |
| `get_spreadsheet`   | One spreadsheet's title and its tabs: sheet ID, title, row and column counts, frozen rows, and the last frozen row's cells (usually the header).                                                                                                                                                                                                                                                                             | `readOnlyHint`                      |
| `read_range`        | The cells in an A1 range, as rows of text, with the range Google read: as shown, or as entered with `valueRenderOption: FORMULA`. At most 5,000 cells; past that, `truncated` is true and `nextRange` says where to read on. With `includeGrid: true`, also `hiddenRows` (row numbers) and `hiddenColumns` (letters) hidden by hand, and `notes`, each a cell's note by its cell, such as `C3`, for the rows that came back. | `readOnlyHint`                      |
| `list_comments`     | A spreadsheet's comments, oldest first: author, time, text, whether resolved, the text it was made on, and its replies. A deleted comment or reply is left out. Paging (`pageSize`, `pageToken`).                                                                                                                                                                                                                            | `readOnlyHint`                      |
| `update_range`      | Writes rows of values over an A1 range. `valueInputOption` is `RAW` (the default: values as given) or `USER_ENTERED`, which lets a formula through.                                                                                                                                                                                                                                                                          | `destructiveHint`, `idempotentHint` |
| `append_rows`       | Adds rows after the table in an A1 range, inserting rows so nothing below is written over. The same `valueInputOption`.                                                                                                                                                                                                                                                                                                      | not destructive, not idempotent     |

Each tool has an `inputSchema` and an `outputSchema`, and answers with `structuredContent` and the same JSON as a text block. A tool that fails answers `isError: true` with one short sentence, such as `Not signed in. Run \`sheets-mcp login\`.`

The reads are marked `readOnlyHint: true` and the writes aren't, so a client can ask before each write. Codex does this by default.

It speaks MCP 2025-06-18 (`initialize`, as Codex opens) and 2026-07-28 (`server/discover`, as Claude Code opens).

## Set up a Google Cloud client

You need your own OAuth client, a _Desktop app_ one, in a Google Cloud project you own. In the [Google Cloud console](https://console.cloud.google.com/):

1. Create a project, or pick one.
2. **APIs & Services → Library:** turn on the **Google Sheets API** and the **Google Drive API**.
3. **Google Auth Platform → Branding:** give the app a name and your email. **Audience:** pick _External_, leave the publishing status at **Testing**, and add your own Google account under **Test users**.
4. **Data access → Add or remove scopes:** add these two, and save:
   - `https://www.googleapis.com/auth/spreadsheets` (read and write your spreadsheets)
   - `https://www.googleapis.com/auth/drive.metadata.readonly` (list files by name and date; nothing of their content)
5. **Clients → Create client:** type **Desktop app**. Keep the client ID, and the client secret if it shows one.

Google treats a Desktop app's secret as no real secret, and the sign-in uses PKCE either way. Keep both out of any repo all the same.

While the app is in Testing, Google ends its sign-ins after 7 days. Run `login` again when the tools say the sign-in expired.

## Sign in

```sh
export GOOGLE_CLIENT_ID=<your client ID>
export GOOGLE_CLIENT_SECRET=<your client secret, if it has one>
node packages/sheets-mcp/src/main.ts login
```

This opens your browser at Google's consent page. Leave both permissions ticked. The browser comes back to a one-time listener on `127.0.0.1`, on a port the system picks, and `login` keeps the refresh token in `~/.config/oriel-sheets-mcp/token.json` (or under `$XDG_CONFIG_HOME`), and the client it signed in with beside it, in `client.json`, so the server needs no environment of its own. Only you may read those files (mode 0600) or their folder (0700).

The server never signs in by itself. With no sign-in, or no client in its environment or kept by `login`, every tool says to run `login`. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the server's environment still work, and win over the kept client. It keeps access tokens in memory only, and refreshes them when they expire.

`node packages/sheets-mcp/src/main.ts logout` deletes the token and the kept client. To revoke the access at Google too, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

No token, code, client ID or client secret is ever printed: not on stdout, not on stderr, not in a tool's answer.

## Add it to your client

Use the absolute path to your checkout, after `login`, which keeps the client the server reads. It needs no environment.

**Claude Code:**

```sh
claude mcp add sheets --scope user -- node /path/to/oriel/packages/sheets-mcp/src/main.ts
```

**Codex:**

```sh
codex mcp add sheets -- node /path/to/oriel/packages/sheets-mcp/src/main.ts
```

### In Oriel

Oriel knows this server by exactly that command: `node`, then the absolute path to `src/main.ts` in the same checkout Oriel runs from. Started any other way, it isn't offered. Once your agent lists it, Settings and the first run offer Google Sheets through it, and Oriel reads and writes your spreadsheets through its tools (decision 0059). On Claude Code, Oriel starts it for each sync or write by that command and its arguments alone, never with an environment an entry gives it, so it reads the client `login` kept. On Codex, Codex starts it as your entry says.

Through it, Oriel reads what it reads through Google's own sign-in: each cell as it shows, with its note, the rows and columns hidden by hand (skipping a hidden row unless the mapping reads hidden rows), and the spreadsheet's comments with their replies. It reads no merges. Drive lets only a sign-in with its read scope list comments, and `login` doesn't ask for that one: with the two scopes above, `list_comments` says Google refused, and Oriel reads no comments. It reads formulas only to leave them alone: a cell holding one, or text that starts with `=`, is never written over. It has no tool to delete a row, so a row a change set added through it can't be taken back there.

Codex asks before each write. Read what a write sends before you approve it: a model that read a cell written to steer it could ask to write your data into someone else's spreadsheet, or, if it passes `USER_ENTERED`, a formula such as `=IMPORTDATA(…)` that sends cells to a web address.

## Fixture mode

`--fixture <file.json>` serves the same tools from spreadsheets held in memory, with no network, no sign-in and no client. Writes change the copy in memory only. It's for tests, evals and trying a client.

With `--shared` too, it reads the file afresh for every call and writes each write to it, so several processes, such as Oriel's sync and its replay, share one. It changes the file: run it on a copy.

`fixture/backlog.json` is a small one: a _Product backlog_ spreadsheet with a header row and 20 rows on its _Backlog_ tab, one cell's note, two comments and a second tab of notes, and a view-only _Release checklist_.

To try it in a client without changing its config:

```sh
P=/path/to/oriel/packages/sheets-mcp

claude -p --strict-mcp-config --mcp-config "{\"mcpServers\":{\"sheets\":{\"command\":\"node\",\"args\":[\"$P/src/main.ts\",\"--fixture\",\"$P/fixture/backlog.json\"]}}}" \
  --allowedTools mcp__sheets__list_spreadsheets,mcp__sheets__read_range \
  "List my spreadsheets, then read the Backlog tab of the Product backlog."

codex exec -c 'mcp_servers.sheets.command="node"' \
  -c "mcp_servers.sheets.args=[\"$P/src/main.ts\",\"--fixture\",\"$P/fixture/backlog.json\"]" \
  "List my spreadsheets, then read the Backlog tab of the Product backlog." < /dev/null
```

A fixture is `{ "spreadsheets": [...] }`. Each spreadsheet has an `id`, a `name`, a `modifiedTime` (RFC 3339), an optional `canEdit` (false for view-only), `tabs`, and optional `comments`. Each tab has a `sheetId`, a `title`, optional `frozenRows`, `rowCount` and `columnCount`, `rows` of strings, and optional `notes` (text by cell, such as `{ "C3": "…" }`), `hiddenRows` (row numbers) and `hiddenColumns` (letters). Each comment has an `author`, `content` and `createdTime`, and optional `resolved`, `deleted`, `quoted` and `replies`, each with an `author`, `content`, `createdTime` and optional `deleted`. The fake computes no formulas: with `USER_ENTERED`, a cell keeps the text as entered.

## Live: one run against Google (the maintainer's)

Tests and dev only ever run fixture mode. A run against Google is the maintainer's, on our test account, never a person's data:

1. Set up a client as above, in the test account's Cloud project, and sign in with the test account: `GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node packages/sheets-mcp/src/main.ts login`.
2. In that account's Drive, make a copy of the shipped fixture's _Product backlog_: a spreadsheet with a frozen header row `Key, Title, Status, Owner, Priority, Estimate, Sprint, Updated` on a tab called _Backlog_.
3. Add the server to Claude Code and to Codex with no environment, as above, and check each lists its six tools: `claude mcp list`, `codex mcp list`.
4. Start Oriel, open Settings → Sources, and turn Google Sheets on through sheets-mcp. Ask the window chat to draft how Oriel reads it, and apply the draft that maps _Backlog_.
5. Check the window shows the backlog's rows, then approve one change set that sets one row's status, and check the cell changed in Google Sheets, and its Undo puts it back. Do it once on each agent.
6. To record its answers for the tests from Codex, which runs no model, point `backlogPicks` in `scripts/record-source-mcp.ts` at the copy's ID for the run, then `node scripts/record-source-mcp.ts sheets --through codex --server sheets`. Read the files before committing them, and put `backlogPicks` back.
7. `node packages/sheets-mcp/src/main.ts logout` when done.

## Develop

```sh
pnpm --filter @oriel/sheets-mcp check
```

The unit tests run every tool against an in-memory stand-in for Google's HTTP APIs (`src/stand-in.ts`, the same one `--fixture` uses). They never reach the network or read the clock.
