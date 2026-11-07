---
title: Found in your agent
status: stable
group: Surfaces
order: 42
classes: found-card, found-rows, found-row, found-what, found-server, found-turns, found-on, found-actions, found-missing
summary: What Oriel found among the MCP servers in the person's agent (decision 0059): the overview's card when that changes, and the rows that say what each server turns on, with a click to turn it on.
---

# Found in your agent

## What it is

Oriel reads a source through a **source server**, an MCP server already in the person's Claude Code or Codex (decision 0059). It asks the agent picked in Settings which servers it has, when Oriel opens and when the person presses Sync, and looks each one up among the servers its connectors know. A server Oriel knows **turns on** a kind, such as Jira, but only once the person says so: nothing turns on by itself.

When what Oriel finds changes, a server appearing or going, the overview shows **one card** saying so (`FoundCard` in `packages/web/src/found.tsx`). Each server found is a row with what it turns on and a button to turn that on (`FoundRows`). A server that went says which kind it turned off. **Dismiss** hides the card, and the same change never brings it back; another change does.

```html specimen id=card title="The overview's card: a server found, which would turn Jira on" width=640
<section class="found-card" aria-labelledby="found-title">
  <h2 id="found-title">Oriel found a source server in Claude Code</h2>
  <p class="connect-note">
    Turned on, Oriel reads that source through it. Nothing turns on until you say.
  </p>
  <ul class="found-rows">
    <li class="found-row">
      <span class="provider-icon" aria-hidden="true">J</span>
      <span class="found-what">
        <span class="found-server">work-tracker</span>
        <span class="found-turns">Atlassian's Jira server · turns on Jira</span>
      </span>
      <button type="button" class="button">Turn on Jira</button>
    </li>
  </ul>
  <div class="found-actions">
    <button type="button" class="quiet-action">Dismiss</button>
  </div>
</section>
```

## When to use it

- When the servers Oriel finds in the agent change, on the overview, above the connect cards.
- The rows alone, wherever a person turns on what Oriel found: the card, and the first run's **See what Oriel found**.

## When not to

- Not for a server Oriel doesn't know. Recognising is a lookup in the connectors' declarations, with no model call, and an unknown server is never offered.
- Not to add, remove, sign in or sign out of a server. Oriel never changes the person's agent; the most it does is link to the vendor's own instructions ([Source servers](/components/source-servers)).
- Not for the agent's doing. The agent may turn a kind off, with Undo under its reply, but never on: only a person turns one on.

## Anatomy and variants

1. **The title** (`h2`): "Oriel found a source server in Claude Code", or "source servers" for several; with only servers gone, "A source server went from Claude Code".
2. **The note** (`.connect-note`): what turning one on does, and that nothing turns on until the person says.
3. **The rows** (`ul.found-rows`, each `li.found-row`): the kind's mark (`.provider-icon`), the server's name in the agent (`.found-server`) over the name Oriel knows it by and the kind it turns on (`.found-turns`), and **Turn on {kind}** (`.button`), or "On" (`.found-on`) once it is.
4. **What went**: one `.connect-note` line each, naming the server and the kind that's off until it's back.
5. **Dismiss** (`.quiet-action`, in `.found-actions`).

## States

- **Turning on**: every Turn on button is disabled until the answer comes.
- **Refused**: why, in a `.connection-problem` line, as when the server isn't listed any more.
- **On**: the row says "On". Once nothing on the card is left to turn on and nothing went, the card goes.

```html specimen id=gone title="A server went: its kind is off until it's back" width=640 state=gone
<section class="found-card" aria-labelledby="gone-title">
  <h2 id="gone-title">A source server went from Claude Code</h2>
  <p class="connect-note">
    work-tracker isn't in Claude Code any more, so Jira is off until it's back.
  </p>
  <div class="found-actions">
    <button type="button" class="quiet-action">Dismiss</button>
  </div>
</section>
```

## Keyboard and ARIA

- The card is a `section` named by its title. Each Turn on button names its kind, so a list of them reads apart.
- Nothing here binds F8, which the bead keeps for the whole window.

## Content

- A server by its name in the person's agent, which they chose; the kind by its name in Oriel, such as Jira.
- Telemetry counts a kind turned on or off, by whom, by its kind only: never the server's name or address.

## Where the app uses it

- The overview (`OverviewPage` in `packages/web/src/overview-page.tsx`).
- The first run's **See what Oriel found** (`Found` in `packages/web/src/setup-page.tsx`), after Your AI and before the connect rows of Your work.
