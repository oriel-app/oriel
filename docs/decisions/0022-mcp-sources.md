# 0022 MCP servers: a transport under a hand-written adapter

Proposed 2026-10-31.

Adds: none

**Decision.**

- **An MCP server can back a read-only source, but only behind a hand-written adapter.** MCP is the adapter's transport, as REST is Jira's. The adapter owns the mapping to 0019's item contract: which tools or resources list items, how to parse what they return, the stable ID, the update time, and what a missing item looks like. There is no generic MCP source.
- **The adapter calls only the tools it names in code.** Its transport takes a fixed list of tool names, each with an argument validator, and refuses any other name before anything reaches the server. A server's annotations (`readOnlyHint`) and its tool list never decide what is called. The client declares no capabilities, so the server can't ask it for sampling, roots or elicitation, and any request from the server gets an error.
- **The server starts at its narrowest scope:** the folder the user picked, one repository, a token with read-only scopes. That scope is the lock; the allowlist is the second line, as 0014 has for GitHub. The sandbox can't reach a server at all: it has no network and can't run processes (0006), and its reads go through the host to `Source.read`.
- **Nothing a server says reaches the agent's instructions.** Its `instructions`, tool names and descriptions are source content, like a Jira description: never in a system prompt or a `.d.ts`. The agent reads an MCP-backed source's items through `items.*` and `search()`, as for any read-only source. No binding wraps a server's tools.
- **No SDK.** The transport is plain JSON-RPC on Node's built-ins: newline-delimited over a child's stdio, or, for a remote server, POSTs whose replies may be an event stream.
- **The server is a child process with only the environment it needs:** `PATH`, `HOME` and its own credential, which Oriel loads from `.env` and never prints. Never Oriel's own environment, which holds the Jira, Slack and model keys. Each request has a deadline, stderr goes to the log with a cap, and a crash fails the sync, so nothing is marked gone.
- **Each server is its own source,** with a kind and key shape in `ids.ts`, fixtures, evals, and an ADR naming the server and its pinned version, by the `add-source` skill. SPEC §4 keeps sources beyond Jira, a folder and Slack out of phase 1, so this decides how, not when.

**Why.** The spike (OA-27) ran three reference servers locally, without credentials: a filesystem server and a demo server that exercises every feature (Node, 2.0.0), and a git server (Python, 2026.8.18). All three negotiated protocol 2025-11-25.

- **No two servers share a shape.**
  - Tools return prose. The filesystem server declares output schemas, but its structured content is the same text in one string field, and its times are local-time strings ("Sat Oct 31 2026 15:06:01 GMT-0700"). The git server prints Python object reprs (`<git.Actor "…">`, `datetime.datetime(…, tzinfo=<… at 0x…>)`) and dates one commit differently in `git_log` and `git_show`.
  - Nothing marks which tool lists items or reads one.
  - Resources are closest to items (a URI, a name, a type, a paged list), but only the demo server offered any, and none had an update time.
  - A missing item is `isError` with English text ("ENOENT: …", "Ref 'nope' did not resolve to an object"), the same channel as "Access denied", so only a parser written for that server can tell 0019's deleted from forbidden.
- **No incremental sync.** A list's `nextCursor` pages one listing; it isn't a change cursor. Change notifications arrive only while connected, and SPEC §14 defers real-time sync. So each sync is a full listing with a null cursor, and deletions come from the worker's sweep, as for the folder.
- **Identity is the adapter's job.** A URI or path carries a name a person wrote, so it can't be a key; it is hashed with the connection's ID, as 0019 does for files. What a rename does depends on the server.
- **Annotations are not a guard.** The filesystem server marks `write_file` `readOnlyHint: false`, and wrote the file when a client called it anyway. Two servers announce `tools.listChanged`, so the list can change mid-session, and annotations come from the server, which is trusted no more than its content.
- **Scope works when it is set.** The filesystem server refused `/etc/hosts` and a symlink out of its folder. The git server, started without `--repository`, read a repository outside the scratch folder; started with it, it refused.
- **Servers write for a model.** The demo server's `instructions` begin "Audience: These instructions are written for an LLM or autonomous agent", and it has tools that make it ask the client to sample a model.
- **Plain JSON-RPC is enough.** A 124-line probe on Node built-ins ran the handshake, paged lists, tool calls, resource reads and a subscribe against all three. Over HTTP, every reply came as an event stream, and requests needed the session ID from `initialize`: without it, 400 "Server not initialized". The official client (2.4.0) brings 13 packages, including a schema library, which SPEC §6 rules out.
- **The protocol still moves.** The demo server also serves a stateless 2026-07-28 era, whose `server/discover` it answered over stdio with "Method not found". An own client must follow versions; pinning each server bounds that.
- **A server costs a process.** Cold start to the first reply: 299 ms (filesystem), 325 ms (demo), 515 ms (git, through uv). The filesystem server installs 94 packages, which run outside the sandbox with whatever access the process has. A child given only `PATH` and `HOME` reported only those, plus one macOS variable, from the demo server's `get-env` tool.

**Rejected.**

- **A generic adapter over any server's resources or tools.** It works only where a server offers resources, and neither real server did. It would have to invent update times, and couldn't tell deleted from forbidden.
- **Trusting `readOnlyHint` or the server's tool list.** Both come from the server, and the write went through.
- **A server's tools as the agent's binding.** Server-written names and descriptions would reach the `.d.ts`, and calls would bypass change sets.
- **The MCP SDK.** Thirteen packages and a schema library for what a small client does. 0008's protocol-standard exception allows it but doesn't require it. Revisit if following the protocol costs more than the client.
- **An MCP gateway.** SPEC §14 defers it.

**Consequences.**

- An MCP-backed source is a normal adapter: `Source` only, with no op catalogue and no writer while it is read-only. Its transport stays inside its package. If it ever writes, the writer comes through `./writer` and change sets, with its own connection.
- Unit tests never start a server. The transport's seam is `(method, params) → result`, faked by replaying recorded JSON-RPC exchanges, as Jira's cassettes do, and the stdio framing is tested over in-memory streams. A record script makes the recordings against the pinned server; live tests run only in a gated job.
- Each server brings a runtime (Node, Python, uv) and its own packages to the user's machine and the hosted image. Its ADR pins the version, and 0008's age rule applies.
- SPEC doesn't change: §4's `JiraSource` seam already allows an MCP transport, and §14 still defers a gateway.
