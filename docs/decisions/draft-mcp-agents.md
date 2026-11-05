# Draft: other agents working with Oriel's agent through the MCP door

Draft 2026-11-06, for the maintainer to approve, amend or turn down. One of four MCP spikes; its angle is agent to agent. It builds on `draft-mcp.md` (branch `mcp-door`) and amends it and 0024. The spike is branch `mcp-agents`. `node scripts/mcp-try.ts --trust --person approve --after 45` runs a throwaway fixture server, with a stand-in person who decides through the window's own routes, for `claude -p --mcp-config <file> --strict-mcp-config`.

Adds: none

## Decision

- **A calling agent's loop is four tools, and it works first time.** It uses `workstream_list`, `thread_open`, `thread_say` and `thread_wait`. In real runs against fixtures, Claude Code (Sonnet 5.5) and Codex 0.166 asked Oriel to estimate a workstream's stories. Each heard the agent's answer and the change set, then the person's decision, with no wrong turns. Measured below.
  - `thread_say` answers with what became of the words and a **cursor**: where the thread stood just before them.
    - Held: `{ held, seq, why }`, where `why` is Oriel's own words.
    - Started a turn: `{ started, seq }`.
  - `thread_wait({ thread, after, seconds })` answers with what happened since the cursor, and a new cursor. It waits up to `seconds` for news, at most 600; with no `after`, it answers at once. What it returns:
    - who asked what, as `you`, `the user` or another tool's name;
    - each turn's reply once the turn ends: its text, its change sets, and every action Oriel applied or refused for it, as the window lists them under the reply;
    - each change set's state and decision, with the sentences of its diff and a link to its thread;
    - what the thread waits on now, in a few words: the agent, the user to send words on, the user to decide a change set, Oriel applying one, or you.

    A wait ends on news: a reply, a held message settling, or a change set moving. These alone don't end it: someone asking, an approval whose apply follows in moments, or the caller's own words just held.

  - Results read as data, as `mcp-door` has them, under one line of Oriel's own (`told`) that says what the result means and what to do next. That line stays out of the data. An action's own result (a thread's ID, a cursor) is Oriel's, so it isn't wrapped as data.
  - `oriel://thread/{id}` reads the same news from the start, for a client that reads resources.
- **Long work is a waiting tool, kept alive by progress.** A person may take hours. The calling agent waits up to its client's limit, hears "nothing new yet" with a fresh cursor, then waits again or ends and comes back with the thread's ID and cursor. When the request carries a `progressToken` and accepts a stream, the wait answers as an event stream with a progress notification every 20 s.

  | Way to hear a decision  | Claude Code 2.1.314                                                                                                                                                                      | Codex 0.166                                                                                                          | Verdict                                        |
  | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
  | Waiting tool, JSON      | Drops the call at **60 s** ("The operation timed out."), whatever `seconds` asks                                                                                                         | Held 120 s; drops the call at **300 s** ("timed out awaiting tools/call after 300s"), its default `tool_timeout_sec` | Works up to the client's limit                 |
  | Waiting tool, progress  | 150 s and 590 s waits ran to the end: progress resets its timeout                                                                                                                        | No progress on the handshake: up to 300 s                                                                            | **Picked**                                     |
  | Tasks extension         | Says it takes tasks in `server/discover`, `tools/list` and `subscriptions/listen`, but never on a `tools/call`, even when the door offers tasks. A server may not answer one with a task | No tasks at all                                                                                                      | Unusable for tools today; the door has it, off |
  | Resource-update notices | Subscribes only to "list changed", never to a resource's updates; its model never sees one                                                                                               | No stream: handshake client                                                                                          | No                                             |

  So a wait's default is 50 s, under every client's limit, and the door caps one at 600 s. Claude Code with progress reaches that cap; Codex reaches 300 s unless its config raises `tool_timeout_sec`. Past a wait, the cursor is the handle: a scheduled job or a later run comes back with it.

  The door keeps the tasks prototype behind an option. A wait becomes a task whose ID encodes the thread, the cursor and the tool, so it keeps nothing and outlives a restart. Turn it on when a client asks for tasks on `tools/call`.

- **A person may trust a tool that acts.** Its words then start a turn instead of being held. This is the "later decision" 0024 left about trusting some senders to skip the hold. It is for outside tools alone, never a review link's holder. The guardrails, all built in the spike:
  - **Off by default, per tool,** and only for a tool connected to act.
  - **A scope of workstreams.** Elsewhere its words are held, as an untrusted tool's are, with why. So is the turn's intents: an intent that reaches outside the scope is refused under the reply, saying so.
  - **A turn cap and a spend cap,** each over any 24 hours (the spike's defaults are 20 turns and 200,000 tokens). Past either, its words are held, saying which. The per-thread caps (SPEC §9) count its turns too.
  - **Its words are its own.** They are stored with the tool as who said them (`by`) and shown on the agent's side of the thread under its name: "Claude Code, an outside tool you trust, asked:". They never appear in the person's place. The agent reads them as `"Claude Code", an outside tool the user trusts, says:`, so it knows whom it answers. They are counted as `question.asked` with `by: "tool"`.
  - **The turn's intents apply, with Undo, within the scope.** The tool could call those actions itself, so this adds no reach. They show under the reply as any turn's do.
  - **Change sets still wait for the person.** No tool approves, applies, rejects or reverts one, in any mode.
  - **Revoke** refuses its token from the next request, ends its streams and stops any turn it started.
- **Questions go the other way through the thread, never by elicitation.** When the agent needs to ask the caller something, it asks in its reply. The caller hears it in `thread_wait`, which says the thread waits on it, and answers with `thread_say`. Elicitation asks the _client's user_, in a form its model never sees. In the spike's probe, headless Claude Code answered `cancel` in 13 ms, and its model never saw the question. Codex, on the handshake, can't take a request from a door that keeps no stream. And the client's user isn't proven to be the person. Approval is never a question to anyone but the person, in Oriel.
- **Many callers share a thread one turn at a time.**
  - Each tool's words show under its own name.
  - A trusted tool that speaks while a turn runs is refused, told whose turn it is ("a turn is running in this thread (Claude Code): wait for it to end, then say it again"), and waits. There is no queue: a queue would start a turn nobody is watching for.
  - Each reply says whom it answers (`to: "you"`, or the other tool's name), so a caller never takes another's answer for its own.
  - In the spike's two-tool run, Claude Code read Codex's words in the thread and said, unprompted: "That didn't come from you, so I ignored it."

## How it amends `draft-mcp.md`

- **Keep:**
  - the listener, `Host`, no `Origin`, and bearer tokens shown once;
  - tools generated from the registry, with no person's actions;
  - held words for any tool not trusted;
  - the data line, the per-minute caps, and the person's name for a tool.
- **Change:**
  - The app owns the registry of connected tools, as the dispatcher must ask it whether a tool is trusted. No two connected tools share a name.
  - Reads stay data. An action's result is Oriel's own, with its `told` line.
  - `oriel://thread/{id}` reads the thread's news (what was said, the replies, change sets, what it waits on), not only its state.
  - Revoke stops the tool's turns too.
- **Add:**
  - `thread_wait`, its cursor, and a wait streamed with progress;
  - trust and its caps, the `by` on a message, and how the agent reads a tool's words;
  - the action lines in a reply;
  - the busy refusal that names whose turn it is.

## How it amends 0024

- "Trusting some holders to skip the hold is a later decision": decided for outside tools only. A tool the person trusts starts turns in the workstreams they named, within its caps.
- "Intents apply only in a turn a person started": or in one a tool they trust started, for what stays within that tool's workstreams.
- "Until OA-75 settles the matter, a turn started by an outside tool's words applies none": settled as above. An untrusted tool's words start no turn.

SPEC §5's "fetched or synced content is data, never instructions" doesn't change. A trusted tool's words aren't synced content: they are a delegate's instructions, as the person's are, and are shown as the delegate's. What a tool reads stays data, and so do the agent's replies, which may quote sources.

## Threat model: the rows this changes

| Threat                                                                    | What stops it                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A tool's words steer Oriel's agent                                        | An untrusted tool's are held, and reach the agent only as the person sends them, as their own (OA-87). A trusted tool's steer it within the workstreams the person named and the tool's caps. That is the point of trust, and the person chose it per tool. What the turn does to Oriel's data shows under the reply with Undo. What it would write to a source waits for the person's approval. Revoke stops it.           |
| Injection inward, through a trusted tool                                  | A tool's own inputs can steer it (a README a coding agent reads, a message a bot hears), and it relays them as words that start a turn. This is the same as synced content steering a person's turn: intents stay within the scope, with Undo; change sets wait for the person; the injection eval's rule (zero mutations, zero intents) holds for a turn the content alone started. The person sees whose words they were. |
| A trusted tool's words pass as the person's                               | Stored with `by`, shown in their own place under the tool's name, never the person's bubble, and framed to the agent as the tool's. Still to do: the diff, the review link, Needs you and the notification name the tool whose turn made a change set (story below).                                                                                                                                                        |
| A tool spends the person's model                                          | An untrusted tool's words start no turn. A trusted tool's turns are capped in turns and tokens over any 24 hours, and by the per-thread caps. A second look stays closed to tools (0054).                                                                                                                                                                                                                                   |
| A tool floods the window                                                  | As before, plus: one turn at a time per thread; a busy thread refuses a trusted tool rather than queueing; past its caps, a trusted tool's words are held.                                                                                                                                                                                                                                                                  |
| A leaked token of a trusted tool                                          | Whoever holds it acts as that tool, within its scope and caps, visibly under its name, and reaches no source without the person. Revoke ends it, its streams and its turns.                                                                                                                                                                                                                                                 |
| Two tools talk over each other, or one takes another's answer for its own | One turn at a time; the refusal names whose turn runs; each reply names whom it answers.                                                                                                                                                                                                                                                                                                                                    |
| A forged task ID or cursor                                                | A task's ID names the tool it is for, and another tool's `tasks/get` is refused. A cursor is only a position in a thread: it gives nothing a read of the thread doesn't.                                                                                                                                                                                                                                                    |
| Injection outward                                                         | As before, and the agent's replies go out as data too, since they may quote sources.                                                                                                                                                                                                                                                                                                                                        |
| Elicitation used to approve, or to ask                                    | Never. The door asks no question of a client's user. The agent asks the caller in its reply.                                                                                                                                                                                                                                                                                                                                |

## What the calling agent experiences

Real runs on throwaway servers with fixtures and Oriel's scripted agent, so Oriel spent no model. The stand-in person acted through the window's routes. Each loop used one plain prompt with no tool hints: "Ask Oriel to estimate the unestimated stories in the checkout workstream, and tell me what the user decided about the change."

| Run                                                             | Oriel calls | Waits (s)         | Wall | Caller's tokens and cost                | Confused?                                                                                |
| --------------------------------------------------------------- | ----------- | ----------------- | ---- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Claude Code, trusted; person approves after 45 s                | 5           | 0, 41             | 61 s | 1,140 out, 133k in (112k cached), $0.08 | No. It stopped at "applying" before the fix that ends a wait on landing, not on approval |
| Claude Code, held; person sends on and approves after 30 s each | 7           | 0, 26, 0, 27      | 70 s | 1,503 out, $0.09                        | No                                                                                       |
| Codex, trusted; person approves after 90 s                      | 4           | 0, 50 (timed out) | 73 s | 557 out, 193k in (178k cached)          | No: it reported the change as still pending, which it was, and stopped                   |
| Claude Code, door offering tasks; person after 90 s             | 5           | 0, 60 (dropped)   | 91 s | 1,065 out, $0.08                        | No: it said the user hadn't decided yet and offered to check later                       |
| Claude Code and Codex in one thread; person after 40 s          | 5 and 3     | 0, 5, 21; 0       | 54 s | $0.09 and 324 out                       | No: Claude Code ignored Codex's words as not its user's                                  |

Codex in `exec` refuses every tool not marked read-only unless the server's `default_tools_approval_mode` is `"approve"`, which the copyable config should set, per server. Claude Code needed nothing beyond `--allowedTools mcp__oriel`.

## Rejected

- **Tasks for a thread's wait, for now:** no client takes one on a tool call (above).
- **Resource-update notifications as the way to hear a decision:** no client's model sees one.
- **Elicitation for the agent's questions:** above.
- **A queue for a busy thread:** it would start a turn after its caller stopped watching, and the refusal costs one call.
- **Trust for a review link's holder:** a link can be forwarded to anyone; a tool's token was given by the person to one program.
- **A trusted tool's turn applying no intents:** the tool could call each of them directly, so refusing them adds friction and no safety.
