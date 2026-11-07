---
title: Source servers
status: stable
group: Rows
order: 53
classes: found-missing
summary: Settings' list of the kinds on, each with the source server it comes through and a switch; what a server Oriel didn't find would turn on, with its vendor's instructions; Look again; and when sync runs.
---

# Source servers

## What it is

The section of Settings › Connections that says what Oriel reads through the person's agent (decision 0059, `SourceServers` in `packages/web/src/found.tsx`). It lists:

- each kind that's on, through a source server found in the agent ("Through work-tracker in Claude Code") or through its own connection, until that connection goes (OA-280), with a [switch](/components/switch) to turn it off;
- each kind a person or the agent turned off, with the switch to turn it on again ("Off, as you asked Oriel");
- each server found whose kind is off, with the switch to turn it on;
- for a kind with a server Oriel knows and none found, that server, and a link to its vendor's own instructions for adding it.

**Look again** asks the agent now, as Sync does. **Sync** picks when Oriel reads: when it opens and when the person presses Sync (the default), or every 15 minutes or every hour. On Claude Code it says that each sync spends a little of the person's plan.

There's no button that adds, removes, signs in or signs out of a server. Oriel never changes the person's agent.

```html specimen id=section title="Jira on through a server in Claude Code, the folder through its connection" width=640
<section class="settings-section" aria-labelledby="ss-title">
  <h2 id="ss-title" class="settings-title">Source servers</h2>
  <p class="settings-lede">
    Oriel reads your sources through the MCP servers in Claude Code. It never adds, removes or signs
    in to one: you do that in Claude Code.
  </p>
  <ul class="provider-rows">
    <li class="provider-row" data-status="ready">
      <span class="provider-icon" aria-hidden="true">J</span>
      <div class="provider-main">
        <span class="provider-name">Jira</span>
        <span class="provider-about">Through atlassian in Claude Code</span>
      </div>
      <div class="provider-side">
        <button type="button" role="switch" class="switch" aria-checked="true" aria-label="Jira on">
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
      </div>
    </li>
    <li class="provider-row">
      <span class="provider-icon" aria-hidden="true">S</span>
      <div class="provider-main">
        <span class="provider-name">Slack</span>
        <span class="provider-about"
          >Off, as you asked Oriel. Its items stay in Oriel for when it's on again.</span
        >
      </div>
      <div class="provider-side">
        <button
          type="button"
          role="switch"
          class="switch"
          aria-checked="false"
          aria-label="Slack off"
        >
          <span class="switch-knob" aria-hidden="true"></span>
        </button>
      </div>
    </li>
  </ul>
  <ul class="found-missing" aria-label="Not found in Claude Code">
    <li>Linear: add Linear's server to Claude Code. <a href="#">How to add it</a></li>
  </ul>
  <div class="cli-actions"><button type="button" class="button">Look again</button></div>
</section>
```

## When to use it

- In Settings › Connections, between the connections and Add a connection.

## When not to

- Not for a connection's own options; those are its [connection row](/components/connection-row).
- Not for the stand-in tracker, which is on by its own rule: while no tracker kind is.

## Anatomy and variants

1. **The title and lede** (`.settings-title`, `.settings-lede`), naming the agent picked in Settings.
2. **The rows** (`.provider-rows`): each kind's mark, its name, how it comes (`.provider-about`), and its [switch](/components/switch) in `.provider-side`.
3. **Not found** (`ul.found-missing`): one line a kind, the server that would turn it on, and **How to add it**, the vendor's own page.
4. **Look again** (`.button`, in `.cli-actions`).
5. **Sync** ([choices](/components/checkbox-radio)): when Oriel reads.

## States

- **Looking**: "Looking in Claude Code…" while nothing is listed yet, and Look again reads "Looking…".
- **A look that failed**: why, naming the agent, in a `.connection-problem` line. What's on stays as it was.
- **Nothing found**: "Oriel hasn't found a source server it knows in Claude Code."
- **On, but it couldn't open through its server** (OA-276): the kind's row keeps its switch on and says why under its line, in a `.connection-problem`, naming the server and, where the agent said why, the agent's own words, such as its plan's limit: "Jira couldn't open through Atlassian's Rovo MCP server. Claude Code couldn't run the call: You've hit your weekly limit." A sync that fails later says so on its connection row instead.
- **On through the one the person picked**: a kind stays on only through the server the person turned it on through. Another server that reports the same name, or sits at the same address under another name, doesn't keep it on or feed it.

## Keyboard and ARIA

- Each switch is a `role="switch"` named for its kind and state, such as "Jira on".
- The vendor's link opens in the browser, as any link out does.

## Content

- A kind off has nothing else in the window: no greyed-out version on the overview, in Browse or in the first run. This row is the one place it shows, so a person can turn it on again.

## Where the app uses it

- Settings › Connections (`Connections` in `packages/web/src/connections-page.tsx`).
- The first run's **See what Oriel found** draws the same Not found lines (`Found` in `packages/web/src/setup-page.tsx`).
