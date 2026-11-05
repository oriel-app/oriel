# 0051 Oriel helps connect a source: the agent drafts a connection's options, and the person applies them

Accepted 2026-11-03. Amends 0024, 0027, 0030, 0038 and 0041. Follows 0049 and 0050. Changes SPEC §1, §2, §7 and §8.

Adds: none

**Decision.**

- **The agent may draft a connection's options, never apply them.** `source.configure` (0049) is the person's, since it decides what Oriel reads, so it is closed to the agent and outside tools. The agent may draft its input instead.
  - A **draft** (SPEC §2) is an action of the person's that the agent writes out for them. In a run, the agent calls the action's function, generated from the registry as every action's is. The sandbox records the call beside intents, checked and capped as they are (0024). The connector's declared validator checks the draft's input, and the composition root supplies it, with the input's type in the module.
  - A turn keeps one set of drafts, as it keeps one set of intents: the last run that recorded any gives them (0024). When the turn ends, they are held in the thread under the reply, never applied. Drafts have their own place in the turn's proposal, beside its change set and intents.
  - **A draft is held as a held message is.** It waits on the person, so its thread stays in Needs you, and New chat doesn't mark it done. It offers Apply, Edit and Discard, in place of Send, Edit and Discard. Only the person applies it, in the window; no review link, outside tool or other agent can.
  - Applying dispatches `source.configure` as the person, as drafted or edited, and its Undo puts back the options it replaced. A draft that the connection's options have since moved past shows as stale, and can't be applied.
  - **Oriel draws a draft from the source, not the agent's words.** The agent names columns by letter and fields by Oriel's names. The window shows each column's letter, the header the sheet has there and the field it would feed, with the first rows as the sheet shows them. A steered agent can draft something odd, but the card can't describe it falsely, as 0030 has it for blocks.
  - **0024 doesn't allow this as it stands,** since only direct actions open to the agent get functions. So an action closed to the agent may declare itself draftable, and the agent's door gains a draft for each. `source.configure` is the first. Nothing that holds credentials is draftable, so `source.connect` isn't.
  - **Not a change set.** A change set is a write to a source that a person approves, in the thread or through a review link (0003). A connection's options are Oriel's own, and a review link would hand them to whoever holds it. 0024 already rejected Oriel's own data as a change set, for the special cases it would add to `packages/changeset`.
- **What the agent reads to draft.** A connector may declare a preview: what the agent sees to draft its options, read live from the source. Google Sheets' is each picked tab's header and first 30 rows. Slack's would be its channels' names and how lately each was active, and Jira's its projects.
  - A connection **waits for its options** when it is new and has none, or when its sync stopped because its options no longer fit its source, such as a mapped column gone. Only then does the window chat's module offer one read of the preview, with the draft's function.
  - The read reaches past the region, the third way beside `search()` and `window.overview()` (SPEC §1.6), so it shows in the transcript as theirs do, and counts for scope discipline (SPEC §8). Its rows aren't items yet, so it is a fourth block form, beside 0030's bars, table and rows, from the same builder: the cells as text under their column letters, the headers as the first row, and at most 30 rows a tab. Nothing in it can be cited or added to a workstream. Its result comes back as tool results, never in a prompt.
- **Onboarding a connection.** After the person picks spreadsheets (0050), the window chat runs one turn, from Oriel's fixed words. They name no title, since a title is synced text (0038): "Draft how Oriel should read the spreadsheets just picked."
  - The turn is the person's, started by their pick, as a question to start from is the person's when they click it (0030). This amends 0027, whose window chat starts only from a question or a cite.
  - The agent reads the preview, then drafts the mapping. For example: the title from B (Feature), the status from D (RAG), the owner from F (DRI), the key from A (ID), and the table ending at its first blank row, so the notes block below it is skipped.
  - The person applies it or edits it, and the first sync reads with it. Applying turns the draft's column letters into the headers above them, so the mapping keeps naming the same columns when one is inserted or moved (0050).
  - **With no AI set up,** Oriel's own guess fills the same card: the first row as the header, the first column whose values are all present and unique as the key, and the first text column as the title. It says it's a guess, and calls no model.
- **The same pattern for any connector with a preview,** whenever one of its connections waits for its options. At first connect, the agent may draft which Slack channels to read, or which Jira project; when a sheet's columns change under its mapping ("Status is now called Stage"), a new mapping. Each is a draft of `source.configure`.
- **The first run (0038).** Google Sheets' row in the source step goes: Connect; the consent line (0050); Google's page, signed in and picked in one tab; back in Oriel, "Reading the headers"; the draft, drawn in the row as 0049's review step; Apply; the first sync; the overview. 0038 sets up the AI first, so the agent is there to draft.
- **The budget** (SPEC §4) stands, timed through Jira. Sheets is a second path, with no token to type but one more turn, so it is measured, not guessed. Telemetry times each phase, the draft's turn included, and OA-191's scripted run gains a Sheets path against the fixture. If the draft makes that path slip past five minutes, the guess shows first, and the agent's draft replaces it when it arrives.
- **Telemetry** (SPEC §7): a draft made (by action), applied (and whether it was edited), discarded or gone stale, never its input.

**Why.**

- The maintainer asked whether Oriel itself can help a person onboard. A mapping is the step a person is least likely to get right alone, and the agent can read the sheet.
- Drafting keeps the person where 0024 puts them: what Oriel reads is theirs to decide.
- Holding a draft as a held message is held gives the person one way to handle what waits on them, and a thread's state already counts it.

**Rejected.**

- **The mapping as a change set to Oriel's own settings.** See above.
- **The agent applying options itself, with an Undo.** What a connection reads is the person's to decide (0024), and a steered agent's mapping could pull a tab into the index before anyone looked.
- **A setup form with no agent.** The guess is the fallback, not the path: it can't tell a notes block from rows, or a RAG column from a stage.
- **Each connector's own namespace in the window chat, for its preview.** Each would reach past the region its own way. One read of a declared preview keeps one door, shown one way.

**Consequences.**

- 0024: an action closed to the agent may be draftable, and the agent's door gains a draft for it. Drafts take a place in the turn's proposal. The repo check fails on a draftable action that is open to the agent or holds credentials.
- 0027: a window chat may also start from a connection's pick.
- 0030: a waiting connection's preview is a fourth block form.
- 0038: Google Sheets' row in the first run gains the review step.
- 0041: the agent may read a connection's options in tool results, and draft them. Settings stays out of its reach.
- SPEC §1.6 and §8 name the preview read beside `search()` and `window.overview()`; §2 gains draft; §7 gains the events.
- The injection eval (SPEC §8) passes only with no draft, except in an onboarding turn, whose draft must ignore what an injected header asks. Two eval cases: the Sheets fixture's tracker tab gets the expected mapping, as a golden, and a tab with an injected header gets one that ignores it.
- The window chat's module gains the preview read and the draft's function only while a connection waits for its options, within a budget their story sets. Other modules and the system prompt don't change.

**Amended by OA-232, 2026-11-05.** A person changes a connection's options by asking, as they set them by asking. The maintainer's direction: "they should be driving this via chat as much as possible and only getting shown the form if they want it."

- **Also while the person asks for a change.** The window chat's module offers the preview read and the draft's function while a connection waits for its options, as above. It also offers them while a connection reads with options its connector drafts in its own form, such as a spreadsheet's mapping, made in the window and not by a flag. That way the person can ask in their own words ("Oriel should read the Sprint 42 tab too"). preview() says such a connection reads, and that the agent drafts a change only when the user asks. Its `options` are how it reads now, in the draft's own form, such as columns by letter, so a draft that changes one tab keeps the others.
- **Ask Oriel.** In Settings, each table a connection reads has Ask Oriel to fix this, and each it doesn't has Ask Oriel to read it. Either starts one window chat turn, the person's, from the connector's fixed words, and the window opens on it. The words name the table by its place, an ID such as a spreadsheet's and its tab's, never a name anyone wrote: "Draft a change to how Oriel reads the tab at {at}." The table must be one of the connection's own. Its preview reads that table first, whatever the cap.
- **The draft is held as before.** The person applies it, edits it or discards it, and only they can. For a connection that reads, the card draws only the tables the draft changes. Before Apply it says what applying does to the items the connection has, by 0050's rules, as Settings' editor does. A new key makes every row a new item. A tab no longer read loses its rows. A table that now begins, ends or skips rows elsewhere loses the rows it no longer covers. Workstreams keep the lost rows as items Oriel no longer has.
- **The form is the fallback, one table at a time.** Settings lists each table read in one line, such as "key ID · title Story · status Status". Tables not read fold into one line that opens to a few at a time, with a search. Edit by hand opens the review step's editor on that table alone.
- **What it costs.** The base module doesn't change. A window chat turn of anyone with a Sheets connection that reads carries Sheets' preview and draft: 1,527 bytes, which until now were carried only while a connection waited.
