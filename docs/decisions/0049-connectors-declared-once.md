# 0049 Connectors are declared once, and a person can make several connections of each

Accepted 2026-11-03. Amends 0019, 0022, 0024, 0036, 0038, 0041 and 0042. Changes SPEC §2, §5 and §7, and the security reviewer's checklist. Amended by 0059: a connection becomes the source server that serves a kind, and the connect steps that ask for secrets go.

Adds: none

**Decision.**

- **Two words** (SPEC §2). A **connector** teaches Oriel one kind of source, such as Jira, a folder, Slack or Google Sheets: one package, `packages/<kind>`, and one entry in `packages/sources`. A **connection** is one account, site, workspace or folder a person connected through a connector, with its own name, options and secret. A connector can have several, such as two Google accounts or two Jira sites.
- **A connector declares itself once.** 0019's declaration already gives an item doc, a panel, facets, a recognizer, overview candidates, a namespace and op specs. It gains:
  - `kind`: its name in item IDs and in the agent's module, such as `sheets`. It is a short lowercase word, never one of Oriel's own spaces.
  - `key`: its items' key shape, as strict as core's `keyShapes` has them now, with no text a person wrote.
  - **How it shows:** its name, its name in a sentence ("the folder"), an icon from a fixed set (a ticket, a page, a message, a row), and what its keys read as ("File", "Message", "Row"). The server sends these to the page, so the page keeps no list of sources.
  - `connect`: the steps of making a connection, and whether the first run offers it, in what order. Each step is one of a few kinds, which the window draws the same way everywhere:
    - `fields`: what the person types, each with its label, whether it is secret, and its help lines and link, such as Jira's address, email and API token, with OA-191's words;
    - `browser`: a sign-in in the person's browser, which the server completes with OAuth's PKCE on a loopback port, and the source's own picker where it has one (decision 0050);
    - `folder`: the system's folder picker through the shell, or a typed path under `pnpm dev`;
    - `pick`: one or many from a list the connector fetches, such as Jira's projects or Slack's channels;
    - `review`: options the agent drafts, for the person to apply or edit (decision 0051).

    A validator declared with each step checks its input and gives its type (0024's shapes). The step's server half, such as checking a site, listing projects or exchanging a code, is the connector's code.

  - `options`: what a person can set per connection, each with a type and a default, drawn the same way in Settings. The types are text, a switch, one of a fixed list, many from a list the connector fetches, a schedule, and a mapping of the source's columns onto Oriel's fields. A validator checks each.
  - `secret`: the validator of what a connection keeps secret, as one value, such as Jira's email and API token, or Google's refresh token. It reaches the store and the connector's `Credential`, and nothing else: no view, log, event or error.
  - `open`: how the connector builds its `Source`, recognizer scope and namespace context from a connection, its options and its secret.
  - `fixture`: the synthetic data's loader and an in-memory stand-in for the source's API, so `--source <kind>=fixture`, unit tests and evals all build the same connection, with no network.
  - `env`: the `.env` names a live connection reads under `pnpm dev`, if any.
  - `budget`: what its item doc and namespace may add to a region's module (OA-26).
- **What stays hand-written,** in the package, as now: sync, the mapping from a source's records to items, the writer, the panel's view, the recognizer, the overview's candidates, and each connect step's server half. The declaration is how Oriel finds them, not what they do.
- **The writer stays apart.** A writable connector adds one line to `packages/changeset/src/writers.ts`, naming its `./writer` export, which builds a writer from a connection, its options and its secret. The declaration can't name it: everything that imports the declarations, the server's thread code included, would then have an import path to a `SourceWriter` (0003). `WriterConfig`'s field per source goes. A test fails when a connector with op specs has no line there, or a line has no connector with op specs.
- **Core keeps no list of kinds.** `SourceKind` is any declared kind. Core's `parseItemId` checks one shape that is safe in generated code: a short lowercase kind, an optional `.` and connection number, a colon, then a key of letters, digits, `.`, `_` and `-`. It gives `{ kind, prefix, key }`, where the prefix is the kind with any number, and names the connection. Its `source` goes, so the compiler lists every caller, and each chooses the kind (what an item is) or the prefix (whose it is). `packages/sources` holds the closed list and checks each kind's own `key`. db, bindings and changeset take kinds as data, from the namespaces, item docs and op specs they are given. So bindings' list of names is still fixed whatever the region holds, now for the life of the server. A test checks that no kind is one of Oriel's own spaces.
- **Connections.**
  - A connection has an ID (a ULID), its connector's kind, a number, a name, its options and its secret. The options are kept in a `connections` table, never with a credential. The folder's own table and Jira's saved connection move into it.
  - **Its secret** is kept under a name the server makes from its ID, `connection.<ULID>`: in the desktop app's secret store (0042), and under `pnpm dev` in a file of its own under `secrets/`, by 0022's rules.
  - **Its sync state,** its cursor and when it last synced, is kept per connection. `sources.kind`'s check constraint goes, so a new connector needs no migration.
  - **Several of one kind.** The first connection of a kind gives its items the bare kind (`jira:SYN-12`), so every ID that exists now keeps its meaning. A later one adds its number (`jira.2:ACME-4`). Every place that keeps an item's source keeps this prefix: the index, workstream members, regions, the change log, references and each source's sync state. So identity is the connection and the source's stable ID (SPEC §7), and two Jira sites' issue 10001 are two items. A `Source`, its `SourceWriter` and the writers are keyed by prefix, and a create that names no item records its connection's prefix on its mutation. The places that cut an ID's prefix by hand move onto `parseItemId` (the audit names them). The agent's namespace is per kind, and a function finds the connection from the IDs it's given. One that names no item, such as a new story with no epic, is offered only for a connection that may propose changes: while exactly one connection of the kind may, or the region holds items from just one such connection, which it goes to.
  - **Signing in again** keeps the connection, its number and its items.
  - **Disconnecting** deletes its secret, its options, and its items from the index and the change log, with the references its items made. References to its items become unresolved, by handle, as a reference to an item the index doesn't have is (0027). Workstreams and regions that held its items see tombstones, which degrade as SPEC §8 asks, and threads keep what was said.
  - **A disconnected connection leaves a tombstone:** its ID, kind and number, and what identifies it in its source, such as Jira's site, Slack's workspace, the Google account or the folder's path. Connecting the same one again revives it, with its ID and number, so its items, a folder's hashed keys included, return under the IDs their workstreams hold. Otherwise a number is never reused.
  - **One live connection per thing.** A connection whose identity matches a live one's is refused, and the window opens that one's options instead. So is a folder inside or around a connected folder, whose files would be items twice.
- **What a person sets per connection.** Settings gains a Connections section (`/settings/connections`), with one row per connection: its name, its connector, what it reads, its state (synced, syncing, a problem, signed out), and its options, drawn from the declaration. Add a connection lists every connector, and Disconnect asks first. Every connection has:
  - **what to sync:** its connector's own option, such as Jira's projects, Slack's channels, a folder, or a set of spreadsheets and their tabs;
  - **read-only, or may propose changes:** a switch, on a writable connector. Read-only, its namespace offers no write function for that connection's items, and no writer is built for it, so a write is unreachable, not merely unapproved. The connector sets the default. A source the person can only view is read-only whatever the switch says;
  - **how often to sync:** when Oriel starts and when asked, every connector's default as now, or every 5, 15 or 60 minutes while Oriel is open;
  - **its name in the window:** from its connector by default, such as "Jira · acme";
  - **the field mapping,** where the connector's items have no fixed fields, such as a spreadsheet's rows: the source's columns onto Oriel's fields (decision 0050).

  A change applies at once, as 0041's do, and the next sync reads with it.

- **Who may change a connection.** Connecting, configuring, syncing and disconnecting are actions in 0024's registry: `source.connect`, by a connector's steps; `source.configure`; `source.sync`, by connection; and `source.disconnect`.
  - Connecting and disconnecting are person-only: one holds credentials, and the other erases what Oriel read.
  - Configuring is the person's too: a direct action closed to the agent and outside tools, whose Undo puts back the options it replaced, as `workstream.delete` is the person's with an Undo. So the agent may draft it (0051), but never apply it. Its input is a connection and its options, which the connector's declared validator checks; the composition root supplies that validator, since core keeps no connector's types.
  - Syncing stays a direct action closed to the agent, as now.
  - Their routes go through the dispatcher, unlike 0041's Settings routes, which stay exempt. The agent may read a connection's options in its tool results, since they describe what it reads. 0041's own settings, the providers, models and look, stay out of its reach entirely.
- **The secret store's names are shapes.** The shell and the server take `anthropic-key`, `connection.` followed by exactly 26 Crockford characters, and for one release `jira` (below), and refuse anything else.
  - The server makes a connection's ID when the connection is made, and never takes one from the page: the page names a connection the server already has, and the server derives the secret's name from it.
  - So the page still can't name a secret, a name can't leave `Secrets/` (a ULID has no `/` or `.`), and no connector adds a name to two lists.
  - Jira's `jira` secret moves to its connection's name at the first start after the change. `jira` stays in both lists for that release, so the move can read and delete it, and leaves them in the next.
- **The first run (0038)** offers, in its source step, each connector whose declaration says it may be a first source, in declared order. Each is a row drawn from its declaration, with 0038's states (connect, reading, read, failed), and its steps drawn by the same component as in Settings. Jira's three fields and its project list become its declared steps, with OA-191's words as they are. Slack's row still waits for an app anyone can install. 0038's budget stands.
- **`pnpm dev`'s flags.** `--source <kind>=fixture|live|window`, once per connector, replaces `--jira`, `--project`, `--slack` and `--channels`, which stay as aliases until the scripts that use them move.
  - A fixture or live connection is made at start from its flag, a row like any other, and a live one reads its connector's declared `.env` names. A window one is made in the window.
  - The database is still one per set of modes, named for them, so fixture, `.env` and window connections never share one, as each Jira mode has its own file today. `--source jira=<mode>` alone keeps today's file. A database's connections keep their secrets in a folder named for it, under `secrets/`.
- **Telemetry** (SPEC §7): `source.connected` gains whether it's a later connection of its kind. A connection configured (which option, never its value), signed in again, or disconnected is a new event.

**Why.**

- The audit (`docs/connectors-audit.md`) found that a new source touches 41 files outside its package today, and the compiler catches a miss in 2. The rest fail at run time or quietly do the wrong thing: its items read as forbidden, its first sync breaks a check constraint, its chips get Jira's icon.
- The maintainer asked for little friction to add a connector, and room to customize each one. One declaration gives both: the window draws what a connector declares, and the person sets what it offers.
- A person has connections, not kinds: two Google accounts are two connections of one connector. Keying secrets, sync state and options by connection makes that work, and the numbered prefix keeps every ID that exists now.
- A shape of names keeps 0042's promise, that a server bug can't reach a file the shell didn't expect, without a new name per connector.
- The audit's probe shows that taking kinds out of core is mechanical: 44 errors in 15 files, of three kinds.

**Rejected.**

- **Connectors loaded at run time from outside the repo.** They would run with the server's rights and the person's credentials. Every connector is reviewed code in the repo (0008).
- **An MCP server as a connector.** 0024 keeps MCP as a source punted (OA-27): a server's tools write directly, so Oriel couldn't make every write a change set.
- **Connectors defined in data, with no code.** A mapping covers tables, but sign-in, sync and writes differ by API.
- **The writer named in the declaration.** See above.
- **Kinds kept in core, a line per connector.** That is two lines per connector, and core knowing source names, which 0019 moved away from.
- **A fixed secret name per connector,** such as `google`. Two Google accounts would collide, and each connector would add a name to two lists.
- **A connection's number in every ID, the first's included.** Every ID in every workstream, thread, eval case and cassette would change, for nothing while a kind has one connection.

**Consequences.**

- 0019: the declaration gains the fields above, and core keeps no list of kinds.
- 0022: a connection made in the window is kept per connection: its options in the database, and under `pnpm dev` its secret in a file of its own under `secrets/`.
- 0024: `source.connect`'s input comes from a connector's steps, and `source.sync` takes a connection. `source.disconnect` is a new person-only action, and `source.configure` a new direct one, closed to the agent and outside tools. The `pick` step's one route replaces `/jira/projects` among the exempt routes.
- 0036 and 0042: the channel's secret names are `anthropic-key` and the `connection.<ULID>` shape, with `jira` for one release.
- 0038: the first run's source step is drawn from declarations.
- 0041: Settings gains Connections, whose routes go through the dispatcher.
- SPEC §2 gains connector and connection; §5 says each connection's secret is kept under its own name; §7 gains the numbered prefix, identity by connection, and the events.
- The security reviewer looks for a secret name outside those names and shapes, and a connection's ID taken from the page.
- The build stories, in order, are in the pull request. The last rewrites the add-source skill.
