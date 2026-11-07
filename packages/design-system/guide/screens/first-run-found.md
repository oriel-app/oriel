---
title: First run › See what Oriel found
order: 6
summary: The first run's step after Your AI (decision 0059): the source servers Oriel found in the person's Claude Code, each with what it turns on and a click to turn that on, then Continue to Your work.
---

# First run › See what Oriel found

## What it shows

Straight after Your AI, Oriel asks the AI the person picked for its MCP servers, and shows the ones it knows (decision 0059). Here Claude Code lists one server Oriel knows, which would turn Jira on, so its row offers **Turn on Jira**. Nothing turns on unless the person clicks. **Continue** goes on to Your work, which starts on Oriel's own tracker if no tracker is on, with today's connect rows after it until OA-280.

With none found, the step says so and names, for each kind, the server that would turn it on and a link to its vendor's own instructions. Oriel never adds or signs in to a server itself, and the word "token" never appears.

```html specimen id=screen title="See what Oriel found: one server, which would turn Jira on" screen height=520
<div class="setup-page">
  <header class="setup-brand">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" />
    </svg>
    Oriel
  </header>
  <main class="setup" aria-busy="false">
    <ol class="setup-steps" aria-label="Setup">
      <li class="setup-step" data-done>
        <span class="setup-step-mark" aria-hidden="true">1</span>Your AI
      </li>
      <li class="setup-step" aria-current="step">
        <span class="setup-step-mark" aria-hidden="true">2</span>Your work
      </li>
    </ol>
    <h1 class="setup-title">See what Oriel found</h1>
    <p class="setup-lede">
      Oriel reads your work through the MCP servers already in Claude Code. It never adds or signs
      in to one; turn on what you want Oriel to read.
    </p>
    <ul class="found-rows">
      <li class="found-row">
        <span class="provider-icon" aria-hidden="true">J</span>
        <span class="found-what">
          <span class="found-server">atlassian</span>
          <span class="found-turns">Atlassian's Rovo MCP server · turns on Jira</span>
        </span>
        <button type="button" class="button">Turn on Jira</button>
      </li>
    </ul>
    <footer class="setup-foot">
      <button type="button" class="button primary setup-next">Continue</button>
    </footer>
  </main>
</div>
```

## Built from

- [First-run column](/components/setup-column): the page, the brand, the steps, the title and lede, and the foot.
- [Found in your agent](/components/found-card): the rows, each with what it turns on.
- [Source servers](/components/source-servers): the Not found lines, when nothing is found.

## Notes for review

- **One step, two screens.** It counts as part of Your work in the steps, so the first run still reads as two steps; the onboarding budget's clock now spends one more click here.
- **Continue whatever was picked.** Continue never waits on a server: a person who turns nothing on starts on Oriel's own tracker.
- **Atlassian's server, known by its address** (OA-276). Jira's one known server is Atlassian's Rovo MCP server at `https://mcp.atlassian.com/v2/mcp`, which lists every tool Oriel reads only at `?tools=all`. A server elsewhere that reports Atlassian's name isn't offered. Turned on, Jira syncs through it; until then the Not found line names it, with Atlassian's own page for adding it.
- **A tracker turning on later.** A person who started on Oriel's own tracker and turns Jira on is offered one change set that makes those issues again in Jira, in a thread named "Into Jira" ([message](/components/message), its note). Approved, Oriel's tracker steps aside; rejected, both stay.
- **Linear's server, known by its address** (OA-278). Linear's one known server is Linear's own at `https://mcp.linear.app/mcp`; its read-only address has no write tools, so it isn't offered. Linear has no connection of Oriel's at all: it turns on only through its server, and its Not found line names it, with Linear's own page for adding it. Turned on, the same move as Jira's makes the tracker's epics again as Linear projects and its stories as the issues in them, in "Into Linear". Linear's server can't delete an issue or a project, so that move offers no Revert, and says why.
