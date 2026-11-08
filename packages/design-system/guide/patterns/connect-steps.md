---
title: Connect steps
order: 50
summary: One component draws a connector's steps, in the connector's own words, wherever a connection is made in the window, which since decision 0059 is only a folder; and one review step draws a connection's mapping, to apply or edit, in Settings. Everything else comes through the person's own source servers.
---

# Connect steps

## The problem

Each source asks for different things. A folder needs a path. A spreadsheet needs a decision about which columns mean what. Drawn by hand in each place, the same step drifts: different labels, different errors, a step that checks here and not there.

Since decision 0059, Oriel asks for nothing to reach a source: Jira, Slack, Linear and Google Sheets come through the MCP servers already in the person's agent, which they turn on from what Oriel found (see [Source servers](/components/source-servers)). No step asks for a site, an email, a sign-in or anything secret. What's left for the window to draw is a folder, which is on the person's disk, and the mapping a spreadsheet needs.

## The pattern

A connector **declares** its steps once, as data, in its own words (decision 0049). One component, `connect-steps.tsx`, draws each kind the same way wherever it shows:

| Step kind | What it asks                                                              | Its primary                                   | Example                                 |
| --------- | ------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| `folder`  | a folder, from the system's picker or by its typed path                   | **Choose a folder…** / **Add** → **Reading…** | a folder of notes                       |
| `review`  | the options Oriel guessed, or the agent drafted (decision 0051), to apply | **Apply** → **Reading…**                      | which columns a sheet's items come from |

Each step's words are the connector's: its labels, placeholders, notes, the waiting line. A refusal is the server's one sentence (see [Forms](/patterns/forms)). Nothing typed stays once the connection is made. A review step is declared on its connector, beside its steps, because a connection through a source server waits for its options too.

Where the steps show:

1. **The first run** (decisions 0038 and 0059): Your work, one row per source it offers. A folder is chosen right in its row. A source on through its server reads before the row shows it; one with no server on names the server that would turn it on and links to its own instructions.
2. **Settings › Connections › Add a connection**: each connector the window connects itself, as a row; **Connect** opens its steps under its name, with **Cancel** as a quiet action.
3. **Settings › Connections**, in a connection's row: its mapping, drawn by the review step. A connection through a source server draws it beside what the person picks through the server, so Google Sheets through sheets-mcp is picked and mapped in the window.

### Add a folder path

On the desktop app the folder comes from the system's picker (**Choose a folder…**, then **Choosing…**). Under `pnpm dev` it's typed:

```html specimen id=folder title="A folder step, typed"
<form class="path-form">
  <label class="path-label"
    >A folder of markdown files, by its path<input
      placeholder="~/notes"
      spellcheck="false"
      autocomplete="off"
  /></label>
  <span class="path-actions"
    ><button type="submit" class="button primary" disabled>Add</button
    ><button type="button" class="quiet-action">Cancel</button></span
  >
  <span class="path-note">Oriel reads its .md files and never changes them.</span>
</form>
```

### Review a draft

A spreadsheet doesn't say which column is an item's key or title. Oriel guesses from the first row, the agent drafts something better in the background (decision 0051), and the person applies one. The step says whose it is: "A first guess. Oriel is drafting.", "Oriel's draft.", or, with no AI, "Oriel's first guess. Check the columns below." The columns that are read are in the accent.

```html specimen id=review title="A review step: Oriel's guess, to apply"
<div role="group" aria-label="How Oriel reads your spreadsheets">
  <p class="connect-note">
    <strong>A first guess. Oriel is drafting.</strong> Each row becomes an item, under the columns
    below. Nothing is read until you apply it.
  </p>
  <div class="review-tables">
    <section class="review-table">
      <div class="review-scroll">
        <table class="block-table">
          <caption>
            Tracker
          </caption>
          <thead>
            <tr>
              <th scope="col" data-feeds>A</th>
              <th scope="col" data-feeds>B</th>
              <th scope="col">C</th>
            </tr>
            <tr>
              <th scope="col" data-feeds>ID</th>
              <th scope="col" data-feeds>Feature</th>
              <th scope="col">Notes</th>
            </tr>
            <tr class="review-feeds">
              <td data-feeds>Row ID</td>
              <td data-feeds>Title</td>
              <td>Content</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>F-1</td>
              <td>Gift card balance at checkout</td>
              <td>—</td>
            </tr>
            <tr>
              <td>F-2</td>
              <td>Saved cards on the website</td>
              <td>Needs the vault first</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul class="review-lines">
        <li>
          Oriel reads rows from row 2 to the end of the sheet, skipping blank rows. Each becomes an
          item.
        </li>
        <li>Other columns become the item's content.</li>
      </ul>
    </section>
    <p class="review-unread">Not read: Archive.</p>
  </div>
  <div class="connect-actions">
    <button type="button" class="button primary">Apply</button>
  </div>
</div>
```

In the app this group is `<div class="connect-review">`; that class has no rules, so the specimen leaves it off. Until there's a guess, the step is a waiting line with a spinner: "Reading the headers". With no guess possible: "Oriel couldn't guess: no column has a different value in every row. Add one, such as an ID, in the sheet, then try again." and **Try again**.

### In Settings

A connection that waits for its mapping shows the review step in its row, under its picks, once they pick something. Once it reads, the mapping folds to one line a tab, each with **Ask Oriel to fix this** and **Edit by hand** (see [Connection row](/components/connection-row)).

```html specimen id=settings title="Settings: Google Sheets through sheets-mcp, waiting for its mapping"
<ul class="provider-rows">
  <li class="provider-row connection-row">
    <span class="provider-icon" aria-hidden="true">S</span>
    <div class="provider-main">
      <span class="provider-name">Google Sheets</span
      ><span class="provider-about">2 spreadsheets</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Waiting for options that fit</span></span
      >
      <p class="settings-field-about">
        Oriel reads it through sheets-mcp, a server in your agent. Turn it off under Source servers.
      </p>
      <div class="connection-options">
        <fieldset class="settings-field">
          <legend class="settings-field-name">Spreadsheets</legend>
          <span class="settings-field-about"
            >2 picked. <button type="button" class="quiet-action">Change</button></span
          >
        </fieldset>
      </div>
      <div class="settings-field connection-mapping">
        <span class="settings-field-name">How Oriel reads each tab</span
        ><span class="settings-field-about"
          >Which columns are an item's ID, title and status, for each tab Oriel reads.</span
        >
        <p class="cli-line cli-waiting" role="status">
          <span class="spinner" aria-hidden="true"></span>Reading the headers
        </p>
      </div>
    </div>
  </li>
</ul>
```

### In the window: a connection that read nothing

Once on, a connection that read nothing says so in Browse, above its clusters, so the window doesn't look as if it failed (`.connected-empty`): a green dot (`.connected-dot`, `--done`) and "{name} is connected", then what it reads in bold and the connector's sentence for an empty source.

```html specimen id=connected-empty title="Browse: Jira connected to a project with no issues yet"
<section class="connected-empty" aria-labelledby="empty-c1-title">
  <h2 id="empty-c1-title">
    <span class="connected-dot" aria-hidden="true"></span>Jira is connected
  </h2>
  <p class="connect-note">
    <strong>SYN</strong> has no issues yet. Epics and stories made there show here when Oriel syncs
    Jira.
  </p>
</section>
```

## Do

- Declare a new connector's steps as data, in its words, and let `ConnectSteps` draw them. Use the step kinds there are.
- Keep each step's primary to its own verb, and its busy label to the -ing form: **Add** → **Reading…**, **Apply** → **Reading…**.
- Say whose a draft is: Oriel's guess, or the agent's.
- Drop what was typed once the connection is made.
- Show why a connector can't be connected now, in its row, instead of hiding it.
- Reach a hosted source through the person's own source server, never through a step of Oriel's.

## Don't

- Don't draw a step by hand in a new place. Import `FolderStep` and `ReviewStep`.
- Don't ask for a site, an email, a sign-in or a secret. A source server does that in the person's agent (decision 0059).
- Don't put a connector's copy in the page. It belongs in the declaration, where it's reviewed once.
- Don't call applying a draft "approving". It's the person's own action (decision 0051); see [Approval](/patterns/approval#where-approve-is-deliberately-absent).
- Don't check a field's format in the page. The connector's server side says what's wrong.

## Where Oriel does it

- The steps: `ReviewStep` and `FolderStep` in `packages/web/src/connect-steps.tsx`. The switch over a connector's steps is `ConnectSteps`, in the same file.
- The declarations: a folder's, `folderConnect` in `packages/folder/src/connecting.ts`; Google Sheets' review words, `sheetsReview` in `packages/sheets/src/preview.ts`.
- The first run: `YourWork` in `packages/web/src/setup-page.tsx`, which chooses a folder in its row.
- Settings: `AddConnection` in `packages/web/src/connections-page.tsx`; a connection's mapping, `MappingOption` in the same file, drawn beside `ServerPicks` for one through a source server.
- Browse: `ConnectNotices` in `packages/web/src/connect-steps.tsx`, a `.connected-empty` for each connection that read nothing, placed by `Page` in `packages/web/src/app.tsx`. CSS: `.connected-empty`, `.connected-empty h2` and `.connected-dot` in `window.css`.
- The draft's tables: `ReviewTables` in `packages/web/src/block.tsx`.
- CSS: `.connect-actions`, `.path-form` and `.review-tables` in `window.css`.

### Drift

- **Two arrangements of the folder step.** `ConnectSteps` in Settings; the first run never uses `FolderStep` (a folder is a button in its row).
- **Failure shapes differ by place**: a `.connect-problem` line in a step and in the first run's row, `.connection-problem` in Settings.
- `.connect-review` has no rules of its own.

Until they're one, copy `ConnectSteps` for a new place a connection is made.
