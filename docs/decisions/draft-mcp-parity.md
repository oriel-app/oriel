# Draft: parity, whatever the window does, a program can do

Draft 2026-11-06, MCP spike A, for the hub to merge with the other three spikes (OA-75, OA-71, OA-72, OA-73). Builds on `draft-mcp.md` (branch `mcp-door`). The spike is branch `mcp-parity`: `node scripts/hub.ts demo` runs it end to end, and `node scripts/mcp-try.ts --mode speak` serves a door for a real client.

Adds: none

## Decision (proposed)

- **A program reads what the window reads, by construction.** Each MCP resource is one of the window's own routes, at the same path under `oriel://` as under `/api/`, answered by the same handler. `oriel://threads/{id}` is `GET /api/threads/{id}`, byte for byte: chat entries, the agent's blocks, change sets and their next steps. Nothing is written twice, so the two can't drift. The list is `packages/server/src/mcp/reads.ts`: 17 reads over 15 routes. Two of them, Needs you and Done, are views of one route, as the sidebar draws them.
- **A program hears what the window hears.** `subscriptions/listen` carries every change the window's streams carry. That is each of Oriel's actions, by whoever, and every turn starting or ending, including a change set proposed in a turn and the person's decision on it. One event-loop turn's changes go out as one notice per URI.
- **Every call a tool makes that changes something has an Undo**, for the tool and for the person. The door keeps each call with the call that undoes it. The tool takes back its own with the generated `undo` tool. The person undoes any tool's call from `GET /api/outside` through the window's one Undo route, and the call is spent for both.
- **A third mode, _speak_.** A tool the person connects to speak for them starts a turn with its words, as the person's would, shown under its name ("Claude Code, an outside tool, for you:"). The turn is the tool's, so none of the agent's intents apply in it (0024), and only the person approves what it proposes (0003). A tool connected to _act_ keeps last night's rule: its words are held.
- **A repo check for parity.** `scripts/check-repo.ts` fails when a window route has no way in for a program and no stated reason. It extends 0024's check on the doors. A route is covered by a read in `reads.ts`; or by the one action it dispatches, whose declaration makes it a tool or says why not; or by its line in `packages/server/src/mcp/parity.ts`, which names the door's way in or says why there's none. Every way named there is checked to exist (`mcp.test.ts`).
- **The window stays a page, not an MCP client.** Its writes already go through the one dispatcher, and with this spike its reads are the door's reads. See "The window as a client".

## The gap, page by page

✓: the door has it. ✗: a person's alone, with the registry's or parity.ts's reason. **gap**: neither yet, and what it would take.

| Page, control                                                  | Window route                                          | Program's way in                                            | Status                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview: workstream cards, Not in a workstream yet            | GET /overview                                         | `oriel://overview`                                          | ✓                                                                                                                                                                                                                         |
| Overview: what changed since last seen (leaving marks it)      | POST /overview/leave                                  | none                                                        | ✗ what the person has seen is theirs                                                                                                                                                                                      |
| Window chat: read                                              | GET /window-chat, GET /threads/:id                    | `oriel://window-chat`, then the thread                      | ✓                                                                                                                                                                                                                         |
| Window chat: ask, New chat                                     | POST /window-chat/messages, /window-chat/new          | none; a program opens a thread of its own                   | ✗ the person's own conversation (0027)                                                                                                                                                                                    |
| Pins, Noticed: read                                            | GET /noticed                                          | `oriel://noticed`                                           | ✓                                                                                                                                                                                                                         |
| Pin, unpin, dismiss a card                                     | POST /noticed/pin, /pins/:id/remove, /noticed/dismiss | none                                                        | **gap** for pin and unpin: person-only "in the spike"; 0030 means `pin.add`/`pin.remove` to be direct, with Undo, for the agent too. The pins story opens them, and tools get them generated. Dismiss stays the person's. |
| Browse, each grouping (epic, assignee, stuck, linked), filters | GET /browse, /browse/items                            | `oriel://browse{?grouping,q,…}`, `oriel://browse/items{?…}` | ✓                                                                                                                                                                                                                         |
| Browse: make a workstream from a cluster                       | POST /workstreams                                     | `workstream_create` (picked only)                           | **gap**: `kind: "cluster"` is user-only because the agent's region doesn't reach the window's clusters. A tool has no region. Open that alternative to tools, not the agent. S                                            |
| Drop links or text on a workstream                             | POST /workstreams/:id/drop                            | `item_search`, then `workstream_add`                        | **gap**, small: the drop's link resolution isn't a read. An `item_resolve` read over `resolveDropped` closes it. S                                                                                                        |
| Workstream: add, remove, rename, done, reopen, with Undo       | POST /workstreams/:id/…                               | `workstream_*` tools, each with `undo`                      | ✓ and the history names the tool                                                                                                                                                                                          |
| Workstream: delete, restore                                    | POST /workstreams/:id/delete, Undo                    | none                                                        | ✗ 0028                                                                                                                                                                                                                    |
| Region-version marker, a cluster open and closed               | in GET /threads/:id, GET /browse/items                | the thread's and Browse's reads                             | ✓                                                                                                                                                                                                                         |
| Item panel, its stamp                                          | GET /items/:item, /items/:item/stamp                  | `oriel://items/{item}`, `…/stamp`, `item_read`              | ✓ only items the index has                                                                                                                                                                                                |
| Thread: read, with its blocks                                  | GET /threads/:id                                      | `oriel://threads/{id}`                                      | ✓                                                                                                                                                                                                                         |
| Thread: open on a workstream, say                              | POST /workstreams/:id/threads, /threads/:id/messages  | `thread_open`, `thread_say`                                 | ✓ held, or a turn when the tool speaks                                                                                                                                                                                    |
| Thread from nothing                                            | POST /threads                                         | `workstream_create` (picked), `thread_open`, `thread_say`   | ✓ but with items: a tool can't start the empty, epic-first plan. Opening `kind: "thread"` to a speaking tool would. S                                                                                                     |
| Thread: done, reopen                                           | POST /threads/:id/done, Undo                          | `thread_done`, `thread_reopen`, `undo`                      | ✓                                                                                                                                                                                                                         |
| Thread: stop, sync now                                         | POST /threads/:id/stop, /sync                         | none                                                        | ✗ OA-75, as `mcp-door` closed them                                                                                                                                                                                        |
| Thread: delete                                                 | POST /threads/:id/delete                              | none                                                        | ✗ 0024                                                                                                                                                                                                                    |
| Held message: send, discard; draft: apply                      | POST /threads/:id/held/:seq/…                         | none                                                        | ✗ 0024, 0051                                                                                                                                                                                                              |
| Change set: diff                                               | POST /change-sets/:id/diff                            | `oriel://change-sets/{id}/diff`                             | ✓ see the diff's preview, below                                                                                                                                                                                           |
| Change set: approve, reject, edit, apply, revert, dismiss      | POST /change-sets/:id/…                               | none                                                        | ✗ 0003                                                                                                                                                                                                                    |
| Second look, its suggestions                                   | POST /change-sets/:id/second-look…                    | none                                                        | ✗ 0054                                                                                                                                                                                                                    |
| Review link: make, revoke; its page                            | POST /change-sets/:id/review-link…, /review/…         | none                                                        | ✗ 0024                                                                                                                                                                                                                    |
| Needs you                                                      | GET /threads (sidebar)                                | `oriel://needs-you`, subscribed                             | ✓                                                                                                                                                                                                                         |
| Done page                                                      | GET /threads                                          | `oriel://done`                                              | ✓                                                                                                                                                                                                                         |
| Search threads                                                 | GET /search                                           | `oriel://search{?q}`, `thread_find`                         | ✓                                                                                                                                                                                                                         |
| Settings, first run                                            | /settings…, /setup…                                   | none                                                        | ✗ 0041, 0038                                                                                                                                                                                                              |
| Connections: list, kinds                                       | GET /connections, /connectors                         | `oriel://connections`, `oriel://connectors`                 | ✓ no secret in either                                                                                                                                                                                                     |
| Connections: sync now                                          | POST /connections/:id/sync                            | `source_sync`                                               | ✓                                                                                                                                                                                                                         |
| Connections: connect, disconnect, the connect steps            | POST /connections…                                    | none                                                        | ✗ 0049                                                                                                                                                                                                                    |
| Connections: options                                           | POST /connections/:id/options                         | none                                                        | **gap**: closed to tools as to the agent, but the agent may _draft_ it (0051). Let a tool's call be held as a draft the person applies, the same primitive. M                                                             |
| Outside tools: each tool's calls, with Undo                    | GET /api/outside (new)                                | each call's own result, and `undo`                          | **gap** in the window: the route and the Undo are built, but no page shows them yet (OA-72's Settings → Outside tools)                                                                                                    |
| Telemetry                                                      | POST /telemetry                                       | none                                                        | ✗ a program's calls are counted as made                                                                                                                                                                                   |

All 79 window routes, by how they're covered: 15 by a read, 10 by one action that is a tool, 28 by one action the registry keeps from tools (with its reason), 6 by a line naming the door's way in, and 20 by a line saying why not.

## What else the spike changed in `mcp-door`

- **Resources mirror routes.** `oriel://workstream/{id}`, singular, with its own hand-built JSON, becomes `oriel://workstreams/{id}`, the workstream page's own view. The thread resource is the page's full view, not a summary.
- **A resource's `{id}` is a ULID**, as the route's own pattern is, so `oriel://threads/events` names no thread and never opens the window's event stream. The door calls the window's routes with GET only, and closes any stream a route answers with.
- **A tool never speaks in the window chat**, which is the person's own (0027). `thread_say` refuses a tool there.
- **The tools' registry lives in the app**, as OA-72's table will. The dispatcher asks it whether a tool speaks. A name is now unique among the tools not revoked, so one name in a record is one tool.
- **The door's watch hears turns**, not only actions, so "a change set is waiting" and "the person decided" both reach a program. Each event-loop turn's changes are batched into one notice per URI.
- **A tool undoing its own rename** may give the name back to Oriel. `notTheUsers` keeps `oriel` out of any tool's own input, so only the stored Undo carries it.
- **A message a speaking tool said** keeps its `by` in the chat row and the view. The page names the tool on it, with the held message's `.held-by` line, so it needs no new class.

## The hub on MCP: can `drive.ts` retire?

`scripts/hub.ts` does the hub's story-filing job over the door, with no browser. Its commands mirror drive's: `threads`, `open <words>`, `say <thread> <text>`, `proposed <thread>` (new: wait for the turn, print what awaits review), and `await <thread>`, with drive's exit codes, from the same `settle`. `scripts/mcp-client.ts` is about 100 lines on `fetch`. The demo on a throwaway server, where a stand-in for the person approves through the window's own route:

```
$ hub open stories
{"thread":"01M6NV1R5S…","state":"working","workstream":"Stories"}
$ hub say 01M6NV1R5S… "Propose estimates for the stories that have none."
{"seq":7,"call":"01M6NV1RA5…","undoable":false}
$ hub proposed 01M6NV1R5S…
open 01M6NV1RBP…
$ hub await 01M6NV1R5S…
{"(the person, in the window)":"reviews and approves 01M6NV1RBP…"}
applied 01M6NV1RBP…
exit 0
```

The whole loop takes 1.0 s, 0.5 s of it the stand-in's pause.

Claude Code 2.1.314, headless, with a speaking token and only the door's tools: one prompt opened a thread, asked for estimates, read the thread back and reported the change set and what needed the person. It made 9 requests (`server/discover`, `subscriptions/listen`, the lists, `thread_open`, `thread_say`, `resources/read oriel://threads/…`, `thread_changeSets`), in 7 turns and 13.2 s, for $0.08. Screenshot: `shots/mcp-parity/claude-code-speaks.png` (gitignored).

**Yes for filing stories, once the door is on main and the desktop app opens it.** The hub keeps:

- every step it uses: open, say, learn, wait;
- the maintainer's single click on Approve.

It gains:

- no Chrome and no `.oriel/chrome` profile;
- no lock;
- no guessing selectors;
- events, not polling;
- an honest record: the hub's words show as the hub's, not the maintainer's typing.

What the hub would lose:

- **Seeing the window.** `look` and `shot` are how the hub checks a UI change and shows the maintainer. Keep `drive.ts` for UI dogfood and screenshots, and retire only its story-filing use.
- **Typing as the person.** A speaking tool's turn applies none of the agent's intents (0024). The agent can't, in the hub's turn, add an item to a workstream on its own. The hub calls `workstream_add` itself, with Undo, which is the same result and an honest record.
- **Driving the person's controls.** drive could press Mark done, drop links and use Browse menus. The door has each of those as a tool, except dropping links (the `item_resolve` gap above).

## The window as a client

Could the window speak to the server through the door, so parity holds by construction? Two ways, honestly costed:

- **The page speaks MCP** (JSON-RPC `tools/call` and `resources/read` for its 50 fetch sites, and `subscriptions/listen` for its event streams): **1–2 weeks**.
  - The door refuses any request with an `Origin`, by design, and the window is a page. The window would need a third listener rule beside 0036's.
  - The page's composite routes (drop, thread from nothing, the window chat) would become tools that only the person holds.
  - It buys little more than what's below.
  - **Not recommended.**
- **One route table, two transports:** `api.ts` takes its actor from the request (the launch secret is the person, a token is that tool) rather than its fixed `user`. The door forwards to the same routes.
  - The dispatcher already refuses a tool every person-only action.
  - The non-dispatching POSTs (settings, setup, the connect steps) take a `person: true` flag, which the exempt list already names.
  - About **2–3 days**: 45 `user` sites, mechanical, plus tests.
  - Worth it only if tools should get the composite routes too.
- **What the spike built: reads by construction.** The door's resources _are_ the window's GET routes, called past the window's guard behind the door's own. That is `reads.ts`, a table of 17 reads and a 40-line matcher, plus a 20-line `Outside.window`, and no read is written twice. Writes were already by construction: one registry, one dispatcher. **Recommended as the shape**, with the parity check holding the rest.

## Keep, change, add (for the hub's merge)

- **Keep from `mcp-door`:**
  - its own listener;
  - Host, no Origin, and the bearer token;
  - the token hash, shown once;
  - tools generated from the registry and the agent's reads;
  - the data line on every read;
  - an acting tool's words held;
  - the caps;
  - revoke ending streams;
  - stateless both-eras handling;
  - the threat model.
- **Change:**
  - resources mirror the window's routes (`oriel://<route>`), not hand-built shapes;
  - the tools' registry lives in the app;
  - names are unique;
  - the watch hears turns, and notices are batched.
- **Add:**
  - the call log with `undo` and `GET /api/outside`;
  - the speak mode;
  - the parity check (`parity.ts`, `reads.ts`, check-repo);
  - `hub.ts` and `mcp-client.ts`;
  - a user message's `by`.

## Risks found

- **Reading a diff through the window's route would have let a read change what an approval writes. Fixed in the spike.** `POST /change-sets/:id/diff` keeps what it read as each change's preview, and the approval hash doesn't cover previews. So a program reading the diff after a sheet's cell moved would have updated the "seen" value that the Sheets writer checks. The person's Approve would then overwrite a value they never saw (0050's "a conflict, never an overwrite"). The door's diff now renders with `changeSets.look`, which keeps nothing: `Outside.diff`, flagged `own: "diff"` in `reads.ts`. The window's route stays as it is. Any later read that goes through a POST route must be checked the same way.
- **A read-only token now reads everything the window reads:** diffs (live from the source), every thread's full chat, held words from review-link holders. That is the residual outward-injection risk `draft-mcp.md` names, now with more surface. Everything is still data-labelled.
- **Words a speaking tool passes on** are cleaned of characters that show as nothing, as a held message's are, so what the person reads under the tool's name is all the agent hears.
- **Undo replays only what is still true.** A tool's Undo of a rename is refused once the name has changed since, so a tool never gives a name back to Oriel over the person's. Each call is spent as its Undo starts, by the tool or the person, and given back only if the Undo fails. Calls are kept by the tool's ID, so a tool connected later under a revoked tool's name can't undo that tool's calls. The person's Undo from the list replays the call's own stored Undo, whatever the request says.
- **A speaking token spends the person's model.** The per-thread caps (SPEC §9) and 30 acts a minute hold, but nothing caps a tool's turns across threads. Add a per-tool daily turn cap, said in Settings.

## How it amends 0024

- "Whether the agent hears words from outside the thread is the user's call": the person makes it once, for one tool, by connecting it to speak. They can't make it per message for that tool. Any other tool's words stay held.
- The registry's reason on `workstream.rename`'s `oriel` ("Only the user's Undo gives a workstream's name back to Oriel") becomes "the user's Undo, or a tool's Undo of its own rename while its name stands". The spike changes the handler, not the declaration's words, because those words reach the agent's module and would need a recording.

## Decisions for the maintainer

1. **Resources mirror the window's routes** (`oriel://threads/{id}` is the thread page). Recommend yes.
2. **A third mode, speak**, off unless the person picks it, with a daily turn cap and plain words in Settings ("its words start Oriel's agent, as yours would; it still can't approve anything"). Recommend yes: without it the hub can't leave `drive.ts`.
3. **A speaking tool's turn applies no intents.** Recommend keeping 0024 as it is: the tool calls the actions itself, each with Undo.
4. **The parity check in `pnpm check`**, with OA-71. Recommend yes.
5. **Workstream from a cluster, and a thread from nothing, open to tools** (not the agent). Recommend yes for the cluster; the thread from nothing for speaking tools only.
6. **The window stays a page**, and gets reads by construction, not MCP. Recommend yes.
7. **The hub moves story-filing to `hub.ts`** once the door ships in the desktop app; `drive.ts` stays for UI work. Recommend yes.

## Stories

- OA-71 amended: route-mirrored resources, a watch that hears turns, batched notices, the parity check (all built here). **M**
- OA-72 amended: tools and their calls in the database; Settings → Outside tools lists each tool's calls with Undo, from `GET /api/outside` (route built). **L**
- Speak mode: the mode, a per-tool daily turn cap, the Settings words, and the message's `by` (built). **S**
- `hub.ts` replaces drive's story-filing, and the hub's brief says how; drive keeps look, shot, click and drop. **S**
- Workstream from a cluster, open to tools. **S**
- `item_resolve`: a link or pasted text to items, as the drop resolves them. **S**
- A diff read that doesn't keep the preview, for the door. **S**
- `source.configure` from a tool held as a draft (0051's primitive). **M**
- Pins as direct actions, generated into tools (0030, the pins story). **M**
