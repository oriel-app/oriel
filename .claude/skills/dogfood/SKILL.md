---
name: dogfood
description: Use Oriel on its own backlog in OA, driving the window from a shell while the maintainer watches and steers in the same window. Use when asked to dogfood, use or try the app, plan the next feature, or play a mock PM.
---

- Run it live: `pnpm --filter @oriel/web build`, then `node packages/server/src/main.ts --jira live --project OA` in the background, logging to a file. It reads `.env` itself; never read it. The log is JSON lines: `agent.response` with `"stop":"done"` ends a turn, `agent.change-set` proposes one, `sync: finished` follows an apply.
- Drive it with `pnpm -s drive <command>`; `scripts/drive.ts` lists the commands. `open` starts Chrome, headed, on its own profile under `.oriel/chrome/`, and later commands attach to it, so the maintainer sees each step and can click and type in the same window. Each command prints the page as an accessibility outline and saves a screenshot to `shots/drive/`; read the screenshot when the look matters.
- Target elements by role and name, as the outline shows them: `'role=button[name="Approve and apply"]'`, or scope with `>>`: `'role=heading[name^="Onboarding"] >> role=button[name="Make group"]'`.
- A model turn takes up to a few minutes. Wait on the log, not on a sleep.
- The maintainer steers from inside the app. Before each step, run `pnpm -s drive threads` and `look`: what they typed in a thread, groups they made and change sets they approved or rejected are instructions. Don't approve a change set they rejected or undo what they did.
- Plan in Oriel, not around it. Make a group from an epic's cluster, open a thread, and have the agent propose the stories; they land in OA only through an approved change set. Epics come from the maintainer, or from the Jira REST API when Oriel can't make them yet.
- What breaks, confuses or feels slow is a finding. File it as a story in OA-1, the dogfood epic, through Oriel, with what happened, why it matters to a PM, and a "Done when" line. Fix findings in their own PRs; the story's key goes in the PR body.
- Mock PMs, until real ones exist. Play one at a time, on a fresh database: stop the server and move `.oriel/live.db` aside. Time the onboarding budget (SPEC §4) from the first writable source connecting to the first approved change, count the word "token", and note every moment they'd have quit (SPEC §13).
  - **Dana**, PM for a payments team: knows Jira well, never opened a terminal, and distrusts tools that write to Jira for her. She wants to see exactly what will change.
  - **Tomás**, first-time PM at a startup: a messy backlog, half of it unestimated, and five minutes before his next meeting. He skims and clicks the first thing that looks right.
  - **Priya**, product lead for three teams: wants to know which epics are stuck and why, and asks questions that reach outside any one group.
- Live writes go only to OA on the throwaway site. Never point the server at another site or project unless the maintainer asks.
