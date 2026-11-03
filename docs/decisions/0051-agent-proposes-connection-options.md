# 0051 Oriel helps connect a source: the agent proposes a connection's options, and the person applies them

Accepted 2026-11-03. Amends 0024, 0038 and 0041. Follows 0049 and 0050. Changes SPEC §7 and §8.

Adds: none

**Decision.**

- **The agent may propose a connection's options, never apply them.** `source.configure` (0049) is the person's, since it decides what Oriel reads. The agent may propose its input.
  - In a run, the agent calls the action's function, generated from the registry as every action's is. The sandbox records the call as it records an intent (0024), checked against the action's validator and counted under the run's cap.
  - When the turn ends, the proposal is held in the thread under the reply, with Apply, Edit and Discard, as a held message waits with Send, Edit and Discard: it waits for the person and never applies on its own. Only the person applies it, in the window. No review link, outside tool or other agent can.
  - Applying dispatches `source.configure` as the person, as proposed or edited. Its Undo is the action's own, which puts back the options it replaced. A proposal that a later run in the turn replaced, or that the connection's options have moved past, shows as stale and can't be applied.
  - **Oriel draws the proposal from the source, not the agent's words.** The agent names columns by letter and fields by Oriel's names. The window shows each column's letter, the header the sheet has there and the field it would feed, with the first rows as the sheet shows them. A steered agent can propose something odd, but the card can't describe it falsely, as 0030 has it for blocks.
  - **A person-only action may declare itself proposable,** and `source.configure` is the first. 0024 as it stands doesn't allow this: connecting is closed to the agent, and 0041 keeps Settings out of its reach. So the agent's door gains a proposal for each proposable action, and the dispatcher still refuses the agent applying one. Nothing that holds credentials is proposable, so `source.connect` isn't.
  - **Not a change set.** A change set is a write to a source that a person approves, in the thread or through a review link (0003). A connection's options are Oriel's own, and a review link would hand them to whoever holds it. 0024 already rejected Oriel's own data as a change set, for the special cases it would add to `packages/changeset`.
- **Onboarding a connection.** After the person picks spreadsheets (0050), the window chat (0027) runs one turn, from fixed words of Oriel's that name no title, since a title is synced text (0038): "Propose how Oriel should read the spreadsheets just picked."
  - The agent reads each picked tab's header and first 30 rows with `sheets.preview()`, which the window chat offers only while a connection waits for its first mapping. They come back as tool results, never in a prompt.
  - It proposes the mapping: for example, title from B (Feature), status from D (RAG), owner from F (DRI), the key from A (ID), rows 2 to 40 as items, and row 41 down as a notes block to skip.
  - The person applies or edits it, and the first sync reads with it.
  - **With no AI set up,** Oriel's own guess fills the same card: the first row as the header, the first column whose values are all present and unique as the key, and the first text column as the title. It says it's a guess, and calls no model.
- **The same pattern for any connector's options.** The agent may propose which Slack channels to read, a Jira project, how often to sync, or a new mapping when a sheet's columns change ("Status is now called Stage"). Each is a proposal of `source.configure`.
- **The first run (0038).** Google Sheets' row in the source step goes: Connect; the consent line (0050); Google's page, signed in and picked in one tab; back in Oriel, "Reading the headers"; the proposal, drawn in the row as 0049's review step; Apply; the first sync; the overview. 0038 sets up the AI first, so the agent is there to propose.
- **The budget** (SPEC §4) stands, timed through Jira. Sheets is a second path, with no token to type, but with one more turn, which is measured, not guessed: telemetry times each phase, the proposal's turn included, and OA-191's scripted run gains a Sheets path against the fixture. If the proposal makes that path slip past five minutes, the guess shows first and the agent's proposal replaces it when it arrives.
- **Telemetry** (SPEC §7): a proposal made (by action), applied (and whether it was edited), discarded or gone stale, never its input.

**Why.**

- The maintainer asked whether Oriel itself can help a person onboard. A mapping is the step a person is least likely to get right alone, and the agent can read the sheet.
- Proposing keeps the person where 0024 puts them: what Oriel reads is theirs to decide.
- Holding a proposal as a held message is held gives the person one way to handle what waits on them.

**Rejected.**

- **The mapping as a change set to Oriel's own settings.** See above.
- **The agent applying options itself, with an Undo.** What a connection reads is the person's to decide (0024), and a steered agent's mapping could pull a tab into the index before anyone looked.
- **A setup form with no agent.** The guess is the fallback, not the path: it can't tell a notes block from rows, or a RAG column from a stage.

**Consequences.**

- 0024: a person-only action may be proposable, and the agent's door gains a proposal for it. The repo check fails on a proposable action that isn't person-only, or one that holds credentials.
- 0038: Google Sheets' row in the first run gains the review step.
- 0041: the agent may read a connection's options in tool results and propose them. Settings stays out of its reach.
- SPEC §8: the injection eval passes only with no proposal too, except in an onboarding turn, where the proposal must ignore what an injected header asks. Two eval cases: the Sheets fixture's tracker tab gets the expected mapping, as a golden, and a tab with an injected header gets one that ignores it.
- The window chat's module gains the proposal function, and `sheets.preview()` while a mapping waits, within a budget its story sets. Other regions' modules and the system prompt don't change.
