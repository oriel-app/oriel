# 0060 Own servers: Oriel's agent uses any server the person turns on, and Oriel calls every tool itself, with no model

Proposed 2026-11-08. Amends 0003, 0036, 0037, 0048 and 0059. Changes SPEC §2, §5 and §7, and the security reviewer's threat model and checklist.

Adds: none

The maintainer, 2026-11-08: "if they have mcps we should just let their harness use what ever the user has setup for themselves. i like the idea of enhancing what someone already has not forcing anyone to work the way we think they should. so if we see a server we can create an interface great! but if they say have a teams mcp they want to use in conjunction with oriel who are we to say no". And: "why does our app need to use haiku to call tools, could we have a deterministic way to execute mcp tools?"

## Decision

### Words (SPEC §2)

- An **own server** is an MCP server in the user's own Claude Code or Codex that a person has turned on for Oriel's agent. Its tools are **reads** or **writes**, as the person's settings for it say.
- A **source server** (0059) is still a server Oriel knows, which Oriel reads a source through. A source server keeps all of 0059: items, Browse, pickers, its connector's parser. It is an own server too, if the person turns it on for the agent as well. The two switches are separate.
- A **call** is a mutation that sends one write tool of an own server, with arguments the agent chose. A person approves it like any mutation.

### Oriel makes every call itself, with no model

- **On Claude Code,** Oriel sends the CLI's `mcp_call` control request: a tool's full name, its arguments and `result_not_for_model: true`. The CLI calls the server through its own connection and sign-in, and answers on the control channel. No user message is ever sent, so no model runs and no plan is spent. The calling process is a **tool host**:
  - `-p`, stream-json in and out, `--tools ""`, `--disable-slash-commands`, `--no-session-persistence` and `--settings` with `disableAllHooks`. It runs in an empty `mkdtemp` folder, with 0037's allowlisted environment.
  - It loads the person's own MCP configuration: no `--strict-mcp-config`, and `--setting-sources user`, as discovery already does. `allowedMcpServers` in its `--settings` names only the servers this host may call, so no other server starts. The CLI starts a local server from the person's own entry, environment and all, which Oriel never reads. A remote one uses the CLI's own sign-in.
  - **Checked at start:** `initialize` must list the capability `mcp_call_result_not_for_model_v1`, and `mcp_status` must report only the named servers. Otherwise the host stops, and the problem names the cause, such as "update Claude Code".
  - Oriel's caller refuses any tool not on the list it was given, before anything is sent. Sync's caller lists the connector's reads, replay's caller lists the change set's tools, and the agent's caller lists the reads of the servers turned on. With no model in the process, this list is the guard. Sync and replay still never share a caller.
- **On Codex,** nothing changes: `mcpServer/tool/call` on a thread that runs no turn (0059). A tool host there is that thread, with only the named servers enabled.
- **The Haiku button press goes:** `callerPrompt`, `shapeOf`, the permission answer that swapped in Oriel's arguments, and the retry when Haiku missed. Sync and replay on Claude Code use the tool host.
- **Versions.** Measured on 2.1.319. `mcp_call` with `result_not_for_model` is present from 2.1.312, below 0037's floor of 2.1.314, so the floor stays. A CLI that doesn't list the capability is refused at start, so a release that drops it fails closed.

### Which servers an agent turn sees

- **Only own servers.** A person turns each one on in Settings. Each starts off. Only a person turns one on, as 0059 has it for kinds. The agent may turn one off with Undo, through 0024's registry. A server Oriel finds that nobody turned on stays out of every turn. A source server isn't an own server until a person turns it on as one.
- **Reads and writes, per tool.** Turning a server on shows its tools in two lists, with what each one does:
  - **Reads (Oriel's agent calls these without asking).** A tool starts here only if its server marks it read-only and doesn't mark it destructive or open-world. The marks come from the server's annotations, as the agent reports them (`readOnly`, `destructive` and `openWorld` on Claude Code; the tool's `annotations` on Codex).
  - **Writes (each one asks you first).** Every other tool, including one with no marks at all, which most tools have.
  - A person can move any tool between the lists, and can turn single tools off. Oriel saves the lists by the server's name and the tool's name.
  - A tool that shows up later, or whose marks change, starts as a write until the person looks. A server whose address or command changes turns off, and the card from 0059 says so.
- **A server's marks are its word, and only start a default.** A server that marks a write read-only by mistake would let the agent send that write without a person's approval. For a server the person installed, that's the residual risk. The person accepts it by turning the server on, and every tool the agent calls without asking is listed in front of them first. A mark can't come from synced content, so an attacker who only edits content can't move a tool.
- **Known servers' tools come from their connector.** For a source server, the connector's `reads` are reads and its `writes` are writes, whatever the server marks. The person can still move them.

### How the agent reaches them

- **Still one CLI tool, `run`.** The agent's own turn keeps all of 0037's lock-down and its `system/init` check, and the same holds for 0048 on Codex. Own servers never load into the agent's CLI. The agent reaches them through two new bindings in the sandbox, which the host serves:
  - `servers()`: each own server that's on, with its tools' names, read or write, and each tool's description and input schema where the person's agent reports them. Codex reports them. Claude Code 2.1.319 reports names and marks only (`mcp_status`; no other control request has more). There, the agent calls a tool by its name, and if the arguments are wrong, the server's error says which it wants. That error is a read's answer too, so it is also untrusted.
  - `call(server, tool, args)`: sends a read tool's call through the agent's caller and returns its answer. A write tool's call is captured as a call mutation and returns a stand-in answer, like any captured mutation (0003).
- **Validated names, never code.** The server's name and the tool's name are strings that `call` checks against the turned-on lists. Nothing a server says becomes part of the system prompt or the `.d.ts`, including its tools' names, descriptions and schemas. Those reach the agent only as a run's result.
- **A read never writes.** A read's answer can lead the agent to propose a write, which waits for a person like any other. No path from a read sends a write in the same turn, or ever without approval. Writes stay out of the agent's caller's tool list.

### Untrusted reads

- **An own server's answer is source content,** attacker-controlled like a Jira description:
  - It reaches the model only inside a run's result.
  - It isn't indexed, kept in the database or turned into items, chips or blocks.
  - The run's record keeps each call's server, tool and arguments, and a hash of the answer (SPEC §7). It doesn't keep the answer.
- **Caps:**
  - Text blocks only, up to 100,000 characters an answer. A longer answer is cut, and the cut is marked.
  - Images and embedded resources are dropped, with a note.
  - At most 20 read calls a run, and the run's existing size and time caps.
  - On Claude Code, `result_not_for_model` means the CLI hands over the server's own content unbounded, up to its 10 MB refusal. Oriel enforces these caps itself.
- **What an answer may steer:** what the agent says and which writes it proposes. It can't approve anything, can't turn a server on or move a tool between the lists, and can't reach past what 0024 lets the agent do.
- **Read arguments leave the machine.** A read's arguments, such as a search query, go to that server. Text the agent read elsewhere can go with them: "search Notion for <the contents of a Jira issue>". This is the main new risk. For that reason:
  - open-world tools don't start as reads;
  - Settings says so when a person turns a server on: "Oriel's agent can send what it reads to this server's read tools";
  - the thread shows every call the agent made, with its server, tool and arguments, under the run, as it shows reads now.

### Writes as change sets

- **A call mutation** holds:
  - the server's name in the agent's configuration;
  - its address or command, as found when the call was captured;
  - the tool's name;
  - the arguments;
  - the agent's own one-line summary, such as "Post to Teams #ops: the release slipped to Friday".

  The change set's hash covers all five. Captured calls count toward the per-change-set mutation cap.

- **The review** (the change-set diff and the review link) shows:
  - Oriel's line: "Call `post_message` on Teams".
  - The agent's summary, labelled as the agent's words, since Oriel can't check it.
  - The arguments exactly, each value as escaped text, with long ones folded and openable.
  - "Can't be undone", before anyone approves.

  A person may edit argument values, which changes the hash and voids an approval, as any edit does (0003).

- **Apply** sends exactly the captured arguments, once, through a caller whose list holds only that tool. Before sending, it checks three things: the server is still on, it's at the same address or command, and the tool is still a write there. If any fails, nothing is sent and the mutation fails with the reason.
  - A call is never idempotent (`OpSpec.idempotent` is false). If it may have reached the server, it's never sent again, and the person gets 0003's dismiss with a warning naming it.
  - The mutation records `applied` with the time and, where the answer gives one, the server's ID. The answer isn't kept.
- **No Revert.** A call's `undo` refuses ("Oriel can't know how to undo a call to Teams"). Following 0059 and #228, a change set with only calls has no Revert, and one that mixes them reverts the rest and names the calls it can't.

### `~/.claude` stays untouched

- Every Claude Code path that handed a server's answer to a model, and so wrote a copy under `~/.claude/projects/<cwd-slug>/…/tool-results/`, goes with the Haiku press. Measured on 2.1.319, without the flag, a 300,000-character answer from `mcp_call` was copied there, even with `--no-session-persistence`. With `result_not_for_model: true`, nothing was written.
- The agent's own turn already declares `anthropic/maxResultSizeChars` on `run` (0037). Own servers' answers reach the model only through `run`, so nothing else spills.
- Oriel never deletes, moves or edits anything under the person's `~/.claude` or `~/.codex`, not even its own leftovers. If a copy turns up, the fix is to stop it being written.

## Why

- The maintainer's direction: enhance what the person already has. A person who uses a Teams server shouldn't need Oriel's permission to use it alongside Oriel.
- Keeping `run` as the agent's one CLI tool keeps 0036's start check ("exactly one tool") and 0037's lock-down whole. Every own-server call passes through Oriel's host, where lists, caps, records and change sets live, not through a model's tool call that only a permission answer stands between.
- `mcp_call` is how the person's own harness reaches its own servers, with its sign-ins and its environment, and Oriel holds nothing (0059's promise).

**Ways to call a tool on Claude Code, compared.** Times are from 2.1.319 on the maintainer's Mac, with a local stdio stand-in and a public remote server that needs no sign-in. The Slack figure is from #234.

|                                             | Speed                                                                                                            | Cost                   | What Oriel holds                                                                   | Terms                                                                                | Work                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today: one Haiku turn per call              | about 55 s for a Slack sync, with a retry when Haiku misses                                                      | plan usage, every call | nothing                                                                            | uses the subscription for calls a program could make                                 | built                                                                                                                                                             |
| (a) Oriel as its own MCP client             | network time only                                                                                                | none                   | every server's tokens, in the Keychain; Slack needs a registered client of Oriel's | each vendor's app terms; Slack's review                                              | large: OAuth with PKCE, dynamic registration, refresh, revocation, per vendor; the person signs in again                                                          |
| (b) Batched Haiku turns                     | one turn per batch, seconds                                                                                      | plan usage             | nothing                                                                            | as today                                                                             | small, but one call per turn is what ties each answer to its call; batched, the permission answer must match calls by order, and a model can reorder or drop them |
| (c) Oriel starts known local servers itself | about 50 ms                                                                                                      | none                   | nothing (sheets-mcp keeps its sign-in in its own folder)                           | none                                                                                 | a second path, only for local servers Oriel knows, and still none of the entry's environment                                                                      |
| **(d) `mcp_call` on the tool host**         | **about 50 ms for the first call to a local server, 1–2 ms after; 130 ms remote; about 225 ms to start the CLI** | **none**               | **nothing**                                                                        | **no model request; the control channel Anthropic's own SDK speaks to the same CLI** | **medium: a tool host, a caller, start checks; the Haiku path deleted**                                                                                           |

- Hooks can't start a call. They see only calls a model made. The Agent SDK's public `Query` has no tool call (its issue #380 asks for one). Its control protocol is what Oriel already speaks (0037), and the SDK would be a new dependency. `claude mcp` only configures.
- **One path for both server types.** Remote servers go through (d), and so do local ones, which the CLI starts from the person's own entry. That lifts OA-279's limit: a local server that needs its entry's environment works on Claude Code now, and Oriel still never reads that environment.
- **Default reads come only from read-only marks** because most servers don't mark their tools at all. The public server measured here marks none, even though all its tools are reads. Treating an unmarked tool as a write costs a person one approval. Treating it as a read could cost an unapproved write.

## Rejected

- **Loading own servers into the agent's CLI turn,** with writes denied by the permission answer. It breaks 0036's "exactly one tool" check. It leaves Codex with no way in, since 0048 stops a turn at any MCP call. A write would be stopped only by the permission answer, not by Oriel's host. And a server's tool descriptions would reach the model as tool definitions.
- **All the person's servers on by default.** That's 0059's rejected "inheriting all the person's servers", and a mail or shell server next to synced text is the injection Oriel's lock-down exists to stop. The person turns each one on.
- **Trusting `readOnlyHint` alone.** It's a mark, not a guarantee. It only starts a default, which the person sees.
- **Mapping an own server's answers to items.** 0059's rule stands: an unknown server's records as items make a poor index. A drafted mapping (0051) is still a later decision.
- **Keeping the Haiku press as a fallback** for a CLI without `mcp_call`. That's two paths to maintain and test. A CLI without the capability is refused and told to update, as 0037 does for other version problems.
- **Narrowing `shapeOf` to Oriel's own IDs first** (Sol, #234, S2). Haiku could only make the one allowed call, with Oriel's arguments, so the harm was small. Deleting the path makes it moot.
- **Cleaning up `~/.claude`.** The maintainer: "not a long term thing i would be comfortable with once we have users".
- **`mcp_toggle` to narrow a tool host's servers.** It may write the person's configuration. `allowedMcpServers` in the process's own `--settings` doesn't.

## Consequences

- **What this supersedes, word for word:**
  - **0059**, "A server Oriel doesn't know isn't offered." → It isn't a kind and has no items. A person may turn it on as an own server, and the agent reaches its tools through `run`.
  - **0059**, "**On Claude Code,** sync is a short turn on the smallest model whose only job is paging: which tool, which cursor. Oriel reads each tool result from the CLI's stream and parses it itself; the model never retypes source content. Its lock-down is 0037's, except that only that one source server is loaded and only its read tools are allowed, by name. A call to anything else is denied, and `system/init` must report exactly that." → On Claude Code, sync calls the source server's read tools through a tool host's `mcp_call`, with no model.
  - **0059**, "on Claude Code, by a turn that may call exactly those tools, which Oriel's permission answer checks call by call, giving the server Oriel's own arguments whatever the model typed; a call to any other tool, or a second call, is denied and fails the replay. A turn that called nothing sent nothing, and is tried once more." → On Claude Code, by a tool host's `mcp_call`, one call per mutation, sent once.
  - **0059**, "The agent's turns never load a source server: its one tool is still `run`, its writes are captured mutations, and a person approves them." → Unchanged, and it also covers own servers: the agent's CLI loads none, and the agent reaches own servers only through `run`.
  - **0059**, Consequences: "Sync on Claude Code costs a little of the person's plan, and is slower than today's REST sync." → It costs none of the person's plan.
  - **0059**, "Every N minutes is a setting, which on Claude Code says it spends a little of the person's plan." → That setting's note goes.
  - **OA-279's amendment in SPEC §7**, "a local server that needs one to start is a problem naming it (start it from Codex, or use a remote server), never a retry with it" → On Claude Code too, the CLI starts a local server from the person's own entry, which Oriel never reads.
  - **0036**, Model use, "Its own tools": stands. Amended to add that the person's own servers reach the agent through `run`'s bindings, never as CLI tools.
  - **0037**, "The lock-down": stands for the agent's turns. The tool host isn't a turn, since it never sends a user message, and its flags are the ones above.
  - **0035** (the index reads once per sync) is unaffected. The lock-down decisions are 0036 and 0037. `server-calls.ts` cites 0035 for the lock-down, and its story fixes that.
- **SPEC §5**, "Writes to a source are unreachable without an approved change set", now covers own servers' writes. It's enforced by the agent's caller holding no write tool, and by the type that only replay's caller holds.
- **SPEC §7**: the model-access line, as above. Telemetry gains these events, each without a server's name, address, tool name or arguments:
  - an own server turned on or off (by the person or the agent);
  - a tool moved between reads and writes;
  - an own-server read (count and answer size);
  - a call proposed, applied, failed or dismissed.
- **The security reviewer's threat model** gains own servers. Its checklist gains:
  - a write tool reachable without a change set;
  - a tool outside a caller's list sent;
  - a server's name, tool name, description or schema in a system prompt or `.d.ts`;
  - an own-server answer kept, indexed or rendered outside a run's result;
  - a tool host that sends a user message;
  - anything written under the person's `~/.claude` or `~/.codex`.
- **Every surface** (CLAUDE.md) gains: Settings' own servers and their two lists, a call in the change-set diff and the review link, a thread's run showing its calls, a dismissed call's warning, an injection eval whose own-server answer asks for a write, the telemetry above, and their design-system pages.
- **Order of stories:**
  1. The tool host on Claude Code: sync and replay through `mcp_call`, local servers from their own entry, and the Haiku path deleted.
  2. Own servers in Settings: turning one on, the two lists, the card when one changes.
  3. `servers()` and `call()` for reads: caps, the run record, the thread's list of calls.
  4. Call mutations: capture, the diff and the review link, apply, no Revert.
  5. An eval in which an own server's answer tries to steer a write, and only a proposal comes of it.
- **Revisit** when Claude Code reports tools' schemas (issue #380), when `mcp_call` gets a public SDK method or changes, and when a person asks for a drafted mapping of an own server's records to items (0051).
