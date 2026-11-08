# @oriel/server

The composition root: the database, the index, the agent's turns, change sets and the window's API. `pnpm dev` runs `src/main.ts`; its flags are described at the top of that file.

## Dogfooding a real source: `--on <kind>`

Since decision 0059, Oriel reads Jira, Slack, Linear and Google Sheets only through the MCP servers in your own agent (Claude Code or Codex). Nothing in Oriel holds a token. To dogfood OA through Atlassian's server:

1. Add Atlassian's MCP server to Claude Code or Codex, as Atlassian's instructions say: <https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/>. Oriel never adds it for you.
2. Sign in to it there, with the agent's own sign-in flow (in Claude Code, `/mcp`), as the account that can see OA.
3. Start Oriel and set that agent as the AI in Settings, so Oriel asks it for its servers.
4. Restart with `pnpm dev --on jira`. At start, Jira turns on through the first server your agent lists for it, as a click in Settings › Source servers would. `--on` is repeatable (`--on jira --on slack`). A kind your agent doesn't list stays off, and the start log says so.
5. In Settings, pick the OA project on Jira's connection. Until you pick one, it reads the first project the server lists.

`--on` opens the `live` database, the one `--jira live` used before, so a connection kept there opens again under its ID, with its project and items. Fixture flags are unchanged: `--source jira=fixture` is the default, and `--on jira` replaces it. At start, Oriel deletes any connection secrets an older `pnpm dev` left under `secrets/`.
