# 0021 Slack, a real source, read-only first

Accepted 2026-10-31.

Adds: none

**Decision.**

- **Slack is phase 1's third source, and a real one.** It replaces the synthetic chat channel that SPEC §3 planned after the first slice. The adapter reads Slack's Web API directly, with no SDK, behind 0019's item contract.
- **Read-only first.** The adapter starts with no write catalogue (OA-23). Replying in a thread comes later, and only as a change set the person approves (OA-28, decision 0003). Oriel is never a bot that listens in Slack or answers on its own.
- **The person picks what Oriel reads.** Like the folder, the source reads only the channels the person picks, with read-only scopes, and nothing else in the workspace.
- **The author is the person in a message's `user`.** A message posted for a person by an app also carries `bot_id`; it is still that person's message.
- **A channel isn't an epic.** Groupings use 0019's facets and never invent a hierarchy Slack doesn't have.
- **Two copies, like Jira:**
  - **A synthetic channel in `fixtures/slack/`** is what CI and evals use. It is frozen, has no real people, and follows SPEC §8's fixture rules.
  - **A test workspace** (`T0CDS3SHGQ6`) is for dogfooding and the adapter's live tests. Its simulated people post from their own accounts, seeded by `pnpm seed:slack` from a local scenario that is never committed (OA-22). Recorded exchanges replace people with numbered placeholders, as `pnpm record:jira` does.
- **Credentials** live in `.env`, as Jira's do. No script writes to any other workspace.

**Why.**

- Much of a team's context lives in conversation. A synthetic channel would only show the contract handles chat-shaped content; a real workspace shows what Slack actually sends, such as app-attributed messages, threads that reply days later, and mentions.
- Reading first keeps 0003 intact: nothing reaches Slack without an approved change set.
- Picking channels, like picking a folder, keeps the index to what the person chose.

**Rejected.**

- **A synthetic channel only.** It would teach the adapter a shape that real workspaces don't have.
- **A bot in the workspace.** It would write without approval, and SPEC §1 already reaches Slack through the review link.
- **Seeding the test workspace from committed fixtures.** The simulated people are private to the maintainer, so the scenario stays local. CI never depends on the workspace.

**Consequences.**

- SPEC §3, §4 and §5 name Slack.
- OA-23 builds the adapter, `fixtures/slack/` and its evals; the fixture is the maintainer's to approve.
- A live Slack test job needs a token in an Actions environment, as the Jira job has. Until then, live checks are run by hand.
- Sources beyond these three still need a decision; OA-27 tries MCP servers as one way to add them.
