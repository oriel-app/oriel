# 0059 Bring your own tools: sources come through the person's own MCP servers, and Oriel keeps a stand-in tracker

Accepted 2026-11-06. Amends 0003, 0019, 0020, 0022, 0037, 0038, 0041, 0042, 0044, 0048, 0049, 0050 and 0051. Changes SPEC §1, §2, §4, §5, §7 and §14, and the security reviewer's checklist.

Adds: none

**Decision.**

Oriel brings nothing of its own to reach a source. The person brings their agent (Claude Code or Codex, as now) and that agent's MCP servers. Oriel finds which servers it can read a source through, and turns on what it knows about that source. What it can't find, it does without, except an issue tracker, which it keeps a small one of its own for.

- **Words** (SPEC §2). A **source server** is an MCP server in the person's own Claude Code or Codex that Oriel reads a source through, such as Atlassian's for Jira. A connector (0049) is still what teaches Oriel one kind; a kind is **on** when a source server Oriel knows serves it. A **stand-in** is Oriel's own small version of a kind, which is on while no source server serves it. An outside tool (0058) is the other direction, a program driving Oriel, and keeps its meaning.
- **The index stays.** The overview, Browse, groupings, search, regions and change sets read the index as now. A source server is only how sync fills it.
- **Kinds Oriel knows, servers Oriel knows.**
  - Each connector keeps its kind's item doc, panel, facets, recognizer, overview candidates, namespace, op specs, fixtures and evals. It gains the list of operations a source server must offer, such as search with a cursor, get one, and each write its op specs name.
  - Each source server Oriel supports has a hand-written parser in its connector's package, from the server's tool results to items and back from mutations to the server's write calls, with fixtures recorded from the real server and an eval. A server is known by its address, the name it reports, and its tools' names; telling which kind a server serves is that lookup, with no model call.
  - A server Oriel doesn't know isn't offered. A mapping the agent drafts for an unknown server, applied by the person as 0051's drafts are, is a later decision.
- **Issues are one shape.** Jira, Linear and the stand-in tracker map onto one shape for issues: a project or epic, a parent, a status and its category, an assignee, an estimate, labels. Browse's groupings, the overview's candidates and "stuck" read that shape. Each source keeps its own extras, such as Jira's sprints and custom fields, in its panel. Item IDs keep their source's kind (`jira:SYN-12`, `linear:ENG-4`), so every ID that exists keeps its meaning.
- **The stand-in tracker.** Oriel keeps its own issues in its database, where the index is their source of truth and nothing syncs. Its kind is a short word its story names, not one of Oriel's own spaces (0049). It is on while no tracker's source server is on. The agent changes it through change sets, as any source; a person's edit in its panel applies at once, with Undo. When a tracker's server turns on, Oriel offers one change set that creates the stand-in's issues there, with their workstreams following the new IDs. Approved, the stand-in steps aside; rejected, both stay. Other kinds have no stand-in: the folder already is one for documents, and the window chat for conversation.
- **Which servers are on.** Oriel lists the person's servers from the agent itself, never from its files: Claude Code's `system/init` and `mcp_status`, and Codex's `mcpServerStatus/list`. It looks each time it starts. When what it finds changes, a card says what turned on or off.
  - Turning a kind on gives Oriel's sync that server's read tools, so only a person turns one on, with a click on that card or in Settings.
  - The agent may turn a kind off, with Undo, through an action in 0024's registry. Turning one on is not an action the agent or an outside tool has.
  - Features follow the agent the person picked in Settings: switching from Claude Code to Codex can change what's on.
  - With a kind off, its surfaces don't show; there's no greyed-out version.
- **Oriel never changes the person's agent's configuration.** It doesn't add, remove, sign in or out of a server. For a kind that's off, the first run and Settings name the server that would turn it on and link to its own instructions.
- **Sync.**
  - **On Codex,** sync calls the source server's read tools directly through the app-server's `mcpServer/tool/call`, with no model and no tokens, with only that server enabled for that process.
  - **On Claude Code,** sync is a short turn on the smallest model whose only job is paging: which tool, which cursor. Oriel reads each tool result from the CLI's stream and parses it itself; the model never retypes source content. Its lock-down is 0037's, except that only that one source server is loaded and only its read tools are allowed, by name. A call to anything else is denied, and `system/init` must report exactly that.
  - **When:** when Oriel opens and when the person presses sync, by default. Every N minutes is a setting, which on Claude Code says it spends a little of the person's plan.
- **Writes are change sets** (0003, unchanged in what a person sees). The agent's turns never load a source server: its one tool is still `run`, its writes are captured mutations, and a person approves them. Replay turns each mutation into the server's write call, by the parser:
  - on Codex, by calling it directly;
  - on Claude Code, by a turn that may call exactly those tools, which Oriel's permission answer checks call by call, giving the server Oriel's own arguments whatever the model typed; a call to any other tool, or a second call, is denied and fails the replay. A turn that called nothing sent nothing, and is tried once more.
    Sync and replay never run in the same process, and sync never has a write tool.
- **No API key in the product.** The first run and Settings offer Claude Code and Codex only. The Messages API with `ANTHROPIC_API_KEY` stays for `pnpm dev` and evals.
- **What goes,** once its kind passes its evals through a source server: Jira's REST client and its API-token connection, Slack's token, Google Sheets' sign-in through Oriel's own Google Cloud client and Picker, the connection secrets of 0022 and 0042, and the connect steps of 0049 that ask for them. The folder stays as it is: it's on the person's disk, and nothing is hosted.
- **Our own Sheets server.** `packages/sheets-mcp` is a private stdio MCP server for Google Sheets that knows nothing of Oriel, built so we can dogfood the Sheets kind with no Google app of Oriel's. It's never published or bundled into the app; a person who wants it adds it to their agent like any server.
- **The first run** (0038) becomes: set up the AI → see what Oriel found, and what each server turns on → start on the stand-in tracker if no tracker is on → ask one question → approve one change. The onboarding budget keeps its five minutes; "connect Jira" becomes "see your work", and the word "token" no longer appears.

**Order.** Each step is a story, built one at a time in the agent and connector code:

1. Issues are one shape: Jira's items and Browse's groupings move onto it, with no change a person sees.
2. The stand-in tracker, and a first run that starts on it.
3. Source servers: finding them, the card, turning a kind on and off, the sync setting.
4. Jira through Atlassian's server: sync on both agents, the parser, recorded fixtures, replay.
5. Slack through Slack's server.
6. Linear through Linear's server.
7. Google Sheets through `packages/sheets-mcp`.
8. Removing what goes.

**Why.**

- SPEC §1's premise is that PMs already have MCP into their systems. Asking them to connect their systems a second time, to Oriel, repeats the step they already took.
- Hosting connections makes Oriel an app every system has to trust: a Google Cloud client that needs Google's review for wider scopes, Atlassian and Slack apps, and secrets in Oriel's store. The person's agent already holds those trusts, and signs in with each vendor's own flow.
- Keeping the index keeps everything that already works: the overview's speed, Browse, the region-version marker, the diff.
- Hand-written parsers for known servers keep the index exact. A mapping that is slightly wrong corrupts it silently.
- Keeping the agent's turns free of source servers keeps 0037's lock-down whole where the model reads attacker-controlled text and makes decisions. Sync and replay are narrow processes with one server and named tools.
- A stand-in tracker means a person with no tools still gets the whole loop, asking and approving, in their first five minutes.

**Rejected.**

- **Dropping the index and asking the source live for every view:** slow, costs the person's plan on every view, and would rebuild most of the window.
- **Any server's records as generic items:** no epics, no facets, no panel worth having.
- **Inheriting all the person's servers in the agent's turns:** a shell, mail or browser server next to synced text is the injection Oriel's lock-down exists to stop.
- **Writing the person's agent configuration for them** (`mcp add`, `mcp login`): it changes their agent everywhere, not just in Oriel. The maintainer ruled it out.
- **Oriel as its own MCP client,** reading server definitions from the agent's files: their sign-ins live in the agent's credential store, which Oriel never reads.
- **Keeping the API-key path:** it has no agent, so no tools to bring.
- **A model call to decide which kind a server serves:** a lookup is instant, the same every time, and can't be steered by a server's description.

**Consequences.**

- Sync on Claude Code costs a little of the person's plan, and is slower than today's REST sync. The default (on open and on sync) keeps it rare.
- A source server's vendor can change its tools. A parser fails closed: a result it can't read stops that sync with a problem naming the server, and keeps the index as it was.
- Kinds and their surfaces now depend on what the agent reports at startup, so the overview, Browse's "by source" and Settings each show only what's on, and every surface check (CLAUDE.md's "Hit every surface") includes "with the kind off".
- Fixtures recorded from real servers are new: each comes from our test site, never a person's data, and is checked in under `fixtures/` with the maintainer's approval as fixtures always are.
- Decision 0058's outside tools are unaffected, and its stories (OA-72 onward) wait behind this order.
- Pilots and onboarding still wait for the desktop app (0029); this changes what its first run asks for, not when it ships.
