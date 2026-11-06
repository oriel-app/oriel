# sheets-mcp

A small MCP server for Google Sheets, over stdio. It lists your spreadsheets, reads their tabs and ranges, and writes ranges and rows, as your own Google account. Add it to Claude Code, Codex or any other MCP client the way you'd add any stdio server.

It has no dependencies. Node 24 runs its TypeScript directly, from a checkout of this repo. It is private: never published, never bundled into anything else.

## Tools

| Tool                | Does                                                                                                                                                              | Annotations                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `list_spreadsheets` | Your spreadsheets, most recently changed first: ID, name, modified time, URL. An optional name filter (`query`), and paging (`pageSize`, `pageToken`).            | `readOnlyHint`                      |
| `get_spreadsheet`   | One spreadsheet's title and its tabs: sheet ID, title, row and column counts, frozen rows, and the last frozen row's cells (usually the header).                  | `readOnlyHint`                      |
| `read_range`        | The cells in an A1 range, as rows of text, with the range Google read. At most 5,000 cells; past that, `truncated` is true and `nextRange` says where to read on. | `readOnlyHint`                      |
| `update_range`      | Writes rows of values over an A1 range. `valueInputOption` is `RAW` (the default: values as given) or `USER_ENTERED`, which lets a formula through.               | `destructiveHint`, `idempotentHint` |
| `append_rows`       | Adds rows after the table in an A1 range, inserting rows so nothing below is written over. The same `valueInputOption`.                                           | not destructive, not idempotent     |

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

This opens your browser at Google's consent page. Leave both permissions ticked. The browser comes back to a one-time listener on `127.0.0.1`, on a port the system picks, and `login` keeps the refresh token in `~/.config/oriel-sheets-mcp/token.json` (or under `$XDG_CONFIG_HOME`). Only you may read that file (mode 0600) or its folder (0700).

The server never signs in by itself. With no sign-in, every tool says to run `login`. It keeps access tokens in memory only, and refreshes them when they expire.

`node packages/sheets-mcp/src/main.ts logout` deletes the token file. To revoke the access at Google too, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

No token, code, client ID or client secret is ever printed: not on stdout, not on stderr, not in a tool's answer.

## Add it to your client

Use the absolute path to your checkout. The server reads its client from its own environment, so give it the same two variables.

**Claude Code:**

```sh
claude mcp add sheets --scope user \
  -e GOOGLE_CLIENT_ID=<your client ID> \
  -e GOOGLE_CLIENT_SECRET=<your client secret> \
  -- node /path/to/oriel/packages/sheets-mcp/src/main.ts
```

**Codex:**

```sh
codex mcp add sheets \
  --env GOOGLE_CLIENT_ID=<your client ID> \
  --env GOOGLE_CLIENT_SECRET=<your client secret> \
  -- node /path/to/oriel/packages/sheets-mcp/src/main.ts
```

Codex asks before each write. Read what a write sends before you approve it: a model that read a cell written to steer it could ask to write your data into someone else's spreadsheet, or, if it passes `USER_ENTERED`, a formula such as `=IMPORTDATA(…)` that sends cells to a web address.

## Fixture mode

`--fixture <file.json>` serves the same tools from spreadsheets held in memory, with no network, no sign-in and no client. Writes change the copy in memory only. It's for tests, evals and trying a client.

`fixture/backlog.json` is a small one: a _Product backlog_ spreadsheet with a header row and 20 rows on its _Backlog_ tab, a second tab of notes, and a view-only _Release checklist_.

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

A fixture is `{ "spreadsheets": [...] }`. Each spreadsheet has an `id`, a `name`, a `modifiedTime` (RFC 3339), an optional `canEdit` (false for view-only), and `tabs`. Each tab has a `sheetId`, a `title`, optional `frozenRows`, `rowCount` and `columnCount`, and `rows` of strings. The fake computes no formulas: with `USER_ENTERED`, a cell keeps the text as entered.

## Develop

```sh
pnpm --filter @oriel/sheets-mcp check
```

The unit tests run every tool against an in-memory stand-in for Google's HTTP APIs (`src/stand-in.ts`, the same one `--fixture` uses). They never reach the network or read the clock.
