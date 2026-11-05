---
title: Connect steps
order: 50
summary: One component draws every connector's steps, in the connector's own words, wherever a connection is made: ask for a site and a token, pick a project, add a folder, review a draft. The first run arranges them as screens; Settings opens them under a row.
---

# Connect steps

## The problem

Each source asks for different things. Jira needs an address, an email and a token, then a project. A folder needs a path. A spreadsheet needs a sign-in on Google's page, then a decision about which columns mean what. Drawn by hand in each place a connection is made, the same step drifts: different labels, different errors, a step that checks here and not there.

## The pattern

A connector **declares** its steps once, as data, in its own words (decision 0049). One component, `connect-steps.tsx`, draws each kind of step the same way wherever it shows:

| Step kind | What it asks                                                              | Its primary                                   | Example                                 |
| --------- | ------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| `fields`  | a few typed values, with help beside them                                 | **Connect** → **Connecting…**                 | Jira's address, email and token         |
| `pick`    | one from a list the source gives                                          | **Use Synthetic** → **Connecting…**           | a Jira project                          |
| `folder`  | a folder, from the system's picker or by its typed path                   | **Choose a folder…** / **Add** → **Reading…** | a folder of notes                       |
| `browser` | a sign-in on the source's own page, in the browser                        | **Continue to Google**                        | Google Sheets                           |
| `review`  | the options Oriel guessed, or the agent drafted (decision 0051), to apply | **Apply** → **Reading…**                      | which columns a sheet's items come from |

Each step's words are the connector's: its labels, placeholders, hints, help, the list's name, the empty line. A refusal is the server's one sentence, naming the fields at fault (see [Forms](/patterns/forms)). Nothing typed stays once the connection is made.

Where the steps show:

1. **The first run** (decision 0038): "Connect where your work lives", one row per connector it offers. **Connect** opens the connector's steps one screen at a time, under a step title and lede, with **Back** as a link-shaped action. A folder is chosen right in its row. Once connected, the row reads the source, with progress, and a step to review shows under it.
2. **Settings › Connections › Add a connection**: every connector as a row; **Connect** opens its steps under its name, with **Cancel** (or **Back** on the pick step) as a quiet action. A connection just made stays open on its review step until it's applied.
3. **The overview's connect card** (and Browse's): the fields and pick steps only, for a window that has no source to change yet.

### Ask for a site and a token

```html specimen id=fields title="A fields step, in the first run's card"
<div>
  <h1 class="setup-title">Connect Jira</h1>
  <p class="setup-lede">
    Three things from your Jira account. Oriel keeps them encrypted on this Mac.
  </p>
  <div class="setup-card">
    <form class="connect-details" aria-label="Your Jira account">
      <div class="connect-fields">
        <label class="connect-field"
          ><span class="connect-label">Your Jira address</span
          ><input
            class="input"
            name="site"
            type="text"
            autocomplete="url"
            spellcheck="false"
            autocapitalize="off"
            placeholder="yourteam.atlassian.net"
          /><span class="connect-hint"
            >The start of the address in your browser when Jira is open.</span
          ></label
        >
        <label class="connect-field"
          ><span class="connect-label">The email you sign in to Jira with</span
          ><input
            class="input"
            name="email"
            type="email"
            autocomplete="email"
            spellcheck="false"
            autocapitalize="off"
            placeholder="you@company.com"
        /></label>
        <label class="connect-field"
          ><span class="connect-label">API token</span
          ><input
            class="input"
            name="token"
            type="password"
            autocomplete="off"
            spellcheck="false"
            autocapitalize="off"
            placeholder="Paste it here"
        /></label>
      </div>
      <div class="connect-actions">
        <button type="button" class="link-action">Back</button
        ><button type="submit" class="button primary" disabled>Connect</button>
      </div>
    </form>
  </div>
</div>
```

The help box under the fields (`.connect-help`, "Atlassian lets you make these for apps like Oriel…") is shown in [Forms](/patterns/forms), with a refusal.

### Pick a project from rows

The source's list as radio rows, the one changed last picked for the person. A search field shows only when the list is longer than one page, or a search is set; it asks the server on Enter or leaving the field, not as they type. The button names what they picked.

```html specimen id=pick title="A pick step"
<form class="connect-pick" aria-label="Jira projects">
  <ul class="choice-rows" role="radiogroup" aria-label="Projects">
    <li data-picked>
      <label class="choice-row"
        ><input type="radio" name="jira-project" value="SYN" checked /><span class="choice-text"
          ><span class="choice-name">Synthetic</span
          ><span class="choice-detail">SYN · 214 issues · changed Nov 2</span></span
        ></label
      >
    </li>
    <li>
      <label class="choice-row"
        ><input type="radio" name="jira-project" value="PAY" /><span class="choice-text"
          ><span class="choice-name">Payments platform</span
          ><span class="choice-detail">PAY · 58 issues · changed Oct 21</span></span
        ></label
      >
    </li>
  </ul>
  <div class="connect-actions">
    <button type="button" class="quiet-action">Back</button
    ><button type="submit" class="button primary">Use Synthetic</button>
  </div>
</form>
```

Empty, it says why and what to do: "Jira accepted your details, but this account can't see any project. Ask your Jira admin for access, or use another account." A search that finds nothing: "No project matches that."

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

A spreadsheet doesn't say which column is an item's key or title. Oriel guesses from the first row, the agent drafts something better in the background (decision 0051), and the person applies one. The step says whose it is: "Oriel's guess, while the agent drafts a better one.", "The agent drafted how Oriel reads them.", or, with no AI, "Oriel's guess, from the first row and the first column with a value in every row." The columns that are read are in the accent.

```html specimen id=review title="A review step: Oriel's guess, to apply"
<div role="group" aria-label="How Oriel reads your spreadsheets">
  <p class="connect-note">
    <strong>Oriel's guess, while the agent drafts a better one.</strong> Each row becomes an item,
    under the columns below. Nothing is read until you apply it.
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
              <td data-feeds>Key</td>
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
        <li>Each row from row 2 is an item, to the end of the sheet.</li>
        <li>Columns that feed nothing are the item's content.</li>
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

```html specimen id=settings title="Settings › Add a connection, Jira opened"
<ul class="provider-rows">
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">J</span>
    <div class="provider-main">
      <span class="provider-name">Jira</span
      ><span class="provider-about">Epics, stories and their details</span>
      <form class="connect-pick" aria-label="Jira projects">
        <ul class="choice-rows" role="radiogroup" aria-label="Projects">
          <li data-picked>
            <label class="choice-row"
              ><input type="radio" name="settings-jira-project" value="SYN" checked /><span
                class="choice-text"
                ><span class="choice-name">Synthetic</span
                ><span class="choice-detail">SYN · 214 issues · changed Nov 2</span></span
              ></label
            >
          </li>
        </ul>
        <div class="connect-actions">
          <button type="button" class="quiet-action">Back</button
          ><button type="submit" class="button primary">Use Synthetic</button>
        </div>
      </form>
    </div>
  </li>
  <li class="provider-row">
    <span class="provider-icon" aria-hidden="true">F</span>
    <div class="provider-main">
      <span class="provider-name">Folder</span
      ><span class="provider-about"
        >Notes saved as files on this Mac, and its folders. Oriel only reads them.</span
      >
    </div>
    <div class="provider-side"><button type="button" class="button">Connect</button></div>
  </li>
</ul>
```

## Do

- Declare a new connector's steps as data, in its words, and let `ConnectSteps` draw them. Use the step kinds there are.
- Keep each step's primary to its own verb, and its busy label to the -ing form: **Connect** → **Connecting…**, **Apply** → **Reading…**.
- Pick the likeliest choice for the person (the one changed last), and name it on the button: **Use Synthetic**.
- Say whose a draft is: Oriel's guess, or the agent's.
- Keep what was typed when going Back, and drop it once the connection is made.
- Show why a connector can't be connected now, in its row, instead of hiding it.

## Don't

- Don't draw a step by hand in a new place. Import `FieldsStep`, `PickStep`, `FolderStep`, `BrowserStep` and `ReviewStep`.
- Don't put a connector's copy in the page. It belongs in the declaration, where it's reviewed once.
- Don't call applying a draft "approving". It's the person's own action (decision 0051); see [Approval](/patterns/approval#where-approve-is-deliberately-absent).
- Don't check a field's format in the page. The connector's server side says what's wrong.

## Where Oriel does it

- The steps: `FieldsStep`, `PickStep`, `BrowserStep`, `ReviewStep` and `FolderStep` in `packages/web/src/connect-steps.tsx`. The switch over them is `ConnectSteps`, and the overview's card `ConnectCard`, in the same file.
- The declarations: Jira's, `jiraConnect` in `packages/jira/src/connecting.ts`; a folder's, `folderConnect` in `packages/folder/src/connecting.ts`; Google Sheets', `sheetsConnect` in `packages/sheets/src/connecting.ts`.
- The first run's screens: `Connect` in `packages/web/src/setup-page.tsx`, which imports the steps and arranges them itself.
- Settings: `AddConnection` in `packages/web/src/connections-page.tsx`.
- The draft's tables: `ReviewTables` in `packages/web/src/block.tsx`.
- CSS: `.connect-details`, `.connect-help`, `.connect-actions`, `.choice-rows`, `.path-form` and `.review-tables` in `window.css`.

### Drift

- **Three arrangements of one step set.** `ConnectSteps` in Settings; `ConnectCard` on the overview (fields and pick only, no Cancel); and the first run, which arranges the parts itself and never uses `FolderStep` (a folder is a button in its row).
- **`.connect-actions` is written twice** with two layouts: one wraps, the other spreads with the primary pushed right (`.connect-actions` twice in `window.css`). `.connect-problem` and `.connect-fields` are each written twice too.
- **Two pick lists.** Settings' **Change** of a picked option draws a plainer list (`.choices`, drawn by `PickOption` in `packages/web/src/connections-page.tsx`) than the pick step's rows.
- **Failure shapes differ by place**: a `.connect-problem` line in a step, a `.cli-box[data-tone="danger"]` with Try again, Change and Copy details in the first run, `.connection-problem` in Settings.
- `.connect-review`, `.connect-browser` and `.connect-consent` have no rules of their own.

Until they're one, copy `ConnectSteps` for a new place a connection is made.
