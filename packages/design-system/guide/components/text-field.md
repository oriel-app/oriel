---
title: Text field
status: drifting
group: Inputs
order: 30
classes: input, connect-field, connect-label, connect-hint, connect-fields, connect-details, connect-problem, provider-path-label, settings-field, path-label, path-note, name-field, held-field, link-field, workstream-title, sidebar-search-field, filter-search
summary: Where a person types something to keep, such as an address, a name, a path or a reason. About nine looks today; copy the connect step's field. Searches have their own framed field.
---

# Text field

## What it is

An `<input>` or `<textarea>` for something a person types to keep: Jira's address, a connection's name, the path to Claude Code, their name on a review link, a held message's new words. There's no single text-field class. One class, `.input`, changes size with where it sits, and six other fields have classes of their own:

| Field                                     | Where                                          | Height or padding | Border           | Text                |
| ----------------------------------------- | ---------------------------------------------- | ----------------- | ---------------- | ------------------- |
| `.input` in a connect step                | Connect Jira, the first run's API key          | 2.25rem           | `--line-strong`  | `--text-md`         |
| `.input` in Settings                      | a path, an API key, a connection's options     | 1.875rem          | `--line-strong`  | `--text-sm`, mono   |
| `.path-label input`                       | a folder's path, typed                         | 0.3125rem padding | `--line-strong`  | `--text-sm`, mono   |
| `.name-field` input and textarea          | the review link page: your name, the reason    | 0.3125rem padding | `--line-strong`  | `--text-sm`         |
| `.held-field` textarea                    | editing a held message or a draft's option     | 0.3125rem padding | `--line-strong`  | inherited           |
| `.link-field` (read-only)                 | a change set's review link                     | 0.125rem padding  | `--line`         | `--text-xs`, mono   |
| `.workstream-title`                       | renaming a workstream, in its heading          | `--head-row`      | none until hover | `--text-xl`, strong |
| `.sidebar-search-field`, `.filter-search` | search, framed with an icon ([below](#search)) | 1.875rem          | `--line`         | inherited           |

The chat inputs (the ask bar and the composers) are their own component: see [Chat input](/components/chat-input). The proposed single field, in modern CSS, is in the [text field lab](/lab/text-field).

## When to use it

- For a value the person types and Oriel keeps: an address, an email, a token, a name, a path, a list of names.
- Use a `<textarea>` where the words may run to lines: a reason, a held message.
- Use `type="password"` for a secret, `type="email"` for an email, `type="search"` for a search.
- Give every field a visible label, except where the field is the heading itself (the workstream's name) or a search with its icon.

## When not to

- Not for asking the agent. That's a [chat input](/components/chat-input): it asks, it doesn't save.
- Not for picking one of a known set. That's [radios](/components/checkbox-radio) or a [select](/components/select).
- Not for showing a value to copy as if it were editable. The review link is a read-only `.link-field` with a Copy action beside it; don't make other read-only text look like a field.
- Not a placeholder in place of a label. A placeholder is an example of the value ("yourteam.atlassian.net", "~/notes"), not its name.

## Anatomy and variants

A field is a label, the input, an optional hint, and a problem line when something's wrong. In the connect step, which is the most complete, that's:

- `<label class="connect-field">` wrapping it all, so clicking the words focuses the field.
- `<span class="connect-label">`: the field's name, strong.
- `<input class="input">`: 2.25rem tall, `--radius`, `--surface`.
- `<span class="connect-hint">`: one line of help under it, faint, `--text-xs`.
- `<p class="connect-problem" role="alert">`: what's wrong, under the fields, in `--danger`.

```html specimen id=connect title="A connect step's fields: Connect Jira"
<form class="connect-details" aria-label="Your Jira account">
  <div class="connect-fields">
    <label class="connect-field">
      <span class="connect-label">Your Jira address</span>
      <input
        class="input"
        name="site"
        type="text"
        autocomplete="url"
        spellcheck="false"
        placeholder="yourteam.atlassian.net"
      />
      <span class="connect-hint">The start of the address in your browser when Jira is open.</span>
    </label>
    <label class="connect-field">
      <span class="connect-label">The email you sign in to Jira with</span>
      <input
        class="input"
        name="email"
        type="email"
        autocomplete="email"
        spellcheck="false"
        placeholder="you@company.com"
      />
    </label>
    <label class="connect-field">
      <span class="connect-label">API token</span>
      <input
        class="input"
        name="token"
        type="password"
        autocomplete="off"
        spellcheck="false"
        placeholder="Paste it here"
      />
    </label>
  </div>
  <div class="connect-actions">
    <button type="submit" class="button primary" disabled>Connect</button>
  </div>
</form>
```

### In Settings

Settings' fields are `.input` too, at 1.875rem and in the mono face, because most of them hold a path or a key. A connection's options set the font back to the inherited one (`.settings :is(.connection-options, .connect-details, .connect-pick) .input` in `window.css`). The label is either `.provider-path-label` (a span over the input) or `.settings-field` (a name and an about line over it). These rules only apply inside `.settings`, so the specimen draws the page around them.

```html specimen id=settings title="Settings › Connections: a name, and a list of names"
<div class="settings">
  <nav class="settings-sections" aria-label="Settings">
    <a class="nav-link" href="/settings">Providers</a>
    <a class="nav-link" href="/settings/connections" aria-current="page">Connections</a>
    <a class="nav-link" href="/settings/general">General</a>
  </nav>
  <div class="settings-body">
    <div class="connection-options">
      <label class="settings-field">
        <span class="settings-field-name">Name</span>
        <span class="settings-field-about">How the window names it.</span>
        <input class="input" value="Ferry ops Slack" placeholder="Slack" maxlength="60" />
      </label>
      <label class="settings-field">
        <span class="settings-field-name">Channels</span>
        <span class="settings-field-about"
          >The public channels Oriel reads, by name, with commas between them.</span
        >
        <input class="input" value="weather-disruptions, checkout-v2" spellcheck="false" />
      </label>
    </div>
  </div>
</div>
```

```html specimen id=settings-path title="Settings › Providers: a path, and an API key" width=390
<div class="settings">
  <div class="settings-body">
    <form class="provider-path">
      <label class="provider-path-label">
        <span>Path to Claude Code</span>
        <input
          type="text"
          class="input"
          value=""
          placeholder="/opt/homebrew/bin/claude"
          spellcheck="false"
          autocomplete="off"
        />
      </label>
      <button type="submit" class="button" disabled>Save</button>
    </form>
    <form class="provider-path">
      <label class="provider-path-label">
        <span>API key</span>
        <input
          type="password"
          class="input"
          placeholder="sk-ant-…"
          spellcheck="false"
          autocomplete="off"
        />
      </label>
      <button type="submit" class="button" disabled>Save</button>
    </form>
  </div>
</div>
```

### Fields with classes of their own

```html specimen id=path title="A folder's path, typed (Oriel in a browser; the desktop app opens the system's picker)"
<form class="path-form">
  <label class="path-label">
    A folder of markdown files, by its path
    <input placeholder="~/notes" spellcheck="false" autocomplete="off" />
  </label>
  <span class="path-actions">
    <button type="submit" class="button primary" disabled>Add</button>
    <button type="button" class="quiet-action">Cancel</button>
  </span>
  <span class="path-note">Oriel reads its .md files and never changes them.</span>
</form>
```

```html specimen id=name-field title="The review link page: the reason and your name (.name-field)"
<form class="review-decide">
  <label class="name-field reason">
    If you reject it, what's wrong? (optional)
    <textarea rows="2" maxlength="2000"></textarea>
  </label>
  <label class="name-field">
    Your name
    <input maxlength="120" autocomplete="name" value="Amara Okafor" />
  </label>
  <div class="review-actions">
    <button type="submit" class="button primary">Approve</button>
    <button type="button" class="button">Reject</button>
  </div>
</form>
```

```html specimen id=held-field title="Editing a held message (.held-field)"
<section class="held-message" aria-busy="false">
  <p class="held-by"><strong>Amara Okafor</strong> rejected this on the review link:</p>
  <textarea class="held-field" rows="3" maxlength="8000" aria-label="Edit Amara Okafor's reason">
The wallet button should sit above the card form, not below it.</textarea>
  <div class="held-actions">
    <span class="held-note">The agent won't see this until you send it.</span>
    <button type="button" class="button primary">Send to agent</button>
    <button type="button" class="button">Cancel</button>
    <button type="button" class="quiet-action">Discard</button>
  </div>
</section>
```

```html specimen id=workstream-title title="Renaming a workstream, in place (.workstream-title)"
<header class="workstream-head">
  <div class="workstream-title-row">
    <input
      class="workstream-title"
      value="Checkout v2: phone wallets and saved cards"
      aria-label="Workstream name"
      maxlength="120"
    />
  </div>
</header>
```

```html specimen id=link-field title="A review link to copy: read-only (.link-field)"
<span class="review-link">
  <input
    class="link-field"
    readonly
    value="https://oriel.example/review/7f3k2q9x"
    aria-label="Review link"
  />
  <button type="button" class="quiet-action">Copy</button>
</span>
```

## States

```html specimen id=state-focus title="Focus visible: a ring 2px out, but 0 out in Settings, and a border alone on the workstream's name" state=focus-visible
<div class="ws-stack">
  <label class="connect-field">
    <span class="connect-label">Your Jira address</span>
    <input class="input ws-focus-visible" placeholder="yourteam.atlassian.net" />
  </label>
  <label class="path-label">
    A folder of markdown files, by its path
    <input class="ws-focus-visible" placeholder="~/notes" />
  </label>
  <header class="workstream-head">
    <div class="workstream-title-row">
      <input class="workstream-title ws-focus" value="Gift cards" aria-label="Workstream name" />
    </div>
  </header>
</div>
```

```html specimen id=state-focus-settings title="Focus visible in Settings: the ring sits on the border" state=focus-visible width=390
<div class="settings">
  <div class="settings-body">
    <label class="settings-field">
      <span class="settings-field-name">Name</span>
      <span class="settings-field-about">How the window names it.</span>
      <input class="input ws-focus-visible" value="Ferry ops Slack" placeholder="Slack" />
    </label>
  </div>
</div>
```

```html specimen id=state-hover title="Hover: only the workstream's name shows a border" state=hover
<header class="workstream-head">
  <div class="workstream-title-row">
    <input class="workstream-title ws-hover" value="Gift cards" aria-label="Workstream name" />
  </div>
</header>
```

```html specimen id=state-error title="Error: the fields the connector names turn red, and one line says why" state=error
<form class="connect-details" aria-label="Your Jira account">
  <div class="connect-fields">
    <label class="connect-field">
      <span class="connect-label">Your Jira address</span>
      <input class="input" name="site" type="text" value="syn-ferries.atlassian.net" />
      <span class="connect-hint">The start of the address in your browser when Jira is open.</span>
    </label>
    <label class="connect-field">
      <span class="connect-label">The email you sign in to Jira with</span>
      <input
        class="input"
        name="email"
        type="email"
        value="amara@syn-ferries.example"
        aria-invalid="true"
      />
    </label>
    <label class="connect-field">
      <span class="connect-label">API token</span>
      <input class="input" name="token" type="password" value="ATATT3xFfGF0" aria-invalid="true" />
    </label>
    <p class="connect-problem" role="alert">
      Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If
      it is, make a new one (step 2) and paste it here.
    </p>
  </div>
</form>
```

```html specimen id=state-disabled title="Disabled: not styled, the browser's own (a connection's name while it saves)" state=disabled width=390
<div class="settings">
  <div class="settings-body">
    <label class="settings-field">
      <span class="settings-field-name">Name</span>
      <span class="settings-field-about">How the window names it.</span>
      <input class="input" value="Ferry ops Slack" placeholder="Slack" disabled />
    </label>
    <div class="connection-said" role="status"><span>Setting its name…</span></div>
  </div>
</div>
```

- **Rest:** a bordered box on `--surface`. The workstream's name has no border at rest; it reads as the page's heading.
- **Hover:** only `.workstream-title` changes, to a `--line` border (`.workstream-title` in `window.css`).
- **Focus visible:** the global ring, 2px out, on most fields (`:focus-visible` in `window.css`). Settings' `.input` and `.select` draw it at 0 offset, on the border (`.settings :is(.input, .select):focus-visible` in `window.css`). The workstream's name turns the ring off and shows a `--line-strong` border on `--surface` instead, on any focus (`.workstream-title:focus` in `window.css`). The searches ring their frame ([below](#search)).
- **Active:** not styled.
- **Disabled:** not styled anywhere. A connection's name and list are disabled while a change saves, and a held field while it sends; each looks like the browser's default disabled input.
- **Read-only:** `.link-field` is muted text in a `--line` border. There's no `:read-only` rule.
- **Busy:** the field's form says it, not the field: the submit button's label ("Connecting…", "Checking…", "Reading…"), or a status line beside it ("Setting its name…").
- **Error:** `aria-invalid="true"` turns an `.input`'s border `--danger` (`.input[aria-invalid]` in `window.css`). Only connect steps and the first run's API key set it. Every other field shows its problem in a line somewhere near it, as below.
- **Empty:** the placeholder, in the browser's own colour. Only the searches style `::placeholder`.

### Where errors go

| Field                  | What shows the problem                                                          | On the field                                  | Tied to it            |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- | --------------------- |
| Connect step           | `.connect-problem` under the fields, `role="alert"`                             | `aria-invalid` on each the connector names    | no `aria-describedby` |
| First run's API key    | `.connect-problem` under it, `role="alert"`                                     | `aria-invalid`                                | no                    |
| Folder path            | `.connect-problem` under the form, `role="alert"`                               | nothing, though the connector names the field | no                    |
| Settings path or key   | `.settings-problem` at the **top of the page**, away from the field             | nothing                                       | no                    |
| A connection's options | `.connection-problem` beside the option, inside a `role="alert"` line           | nothing                                       | no                    |
| Review page, your name | "Type your name first." in `.change-set-problem` under the card, `role="alert"` | nothing                                       | no                    |
| Held message, draft    | `.composer-notice` at the foot of the thread                                    | nothing                                       | no                    |
| Workstream's name      | `.notice[data-tone="error"]` under the page's Ask box                           | nothing                                       | no                    |

No field anywhere is tied to its hint or its problem with `aria-describedby`. A screen reader hears an alert when the problem shows, but not again on returning to the field.

## Keyboard and ARIA

- Every field has an accessible name. Most get it from a wrapping `<label>`. The workstream's name, a held field and the review link have only `aria-label` ("Workstream name", "Edit Amara Okafor's reason", "Review link").
- Enter in a single-line field submits its form. The workstream's name and a connection's name save on Enter or on leaving the field (blur); there's no Save button.
- A `.settings-field`'s about line and a `.connect-hint` sit inside the `<label>`, so they become part of the field's name rather than its description. Keep them short.
- `aria-invalid` is set only while the connector says that field is wrong, and cleared on the next try.
- Use `spellcheck="false"` on addresses, paths, keys and lists of names, and `autocomplete` for what the browser can fill: `url`, `email`, `name`, or `off` for a secret.

## Content

- A label is what to type, in sentence case, as a phrase: "Your Jira address", "The email you sign in to Jira with", "Path to Claude Code".
- A placeholder is an example, not an instruction: "yourteam.atlassian.net", "you@company.com", "~/notes". "Paste it here" is the one instruction, for a token no one types.
- A hint is one sentence on where to find the value: "The start of the address in your browser when Jira is open."
- Say "(optional)" at the end of an optional field's label: "If you reject it, what's wrong? (optional)".
- A problem says what's wrong and what to do: "Type your Jira address, like yourteam.atlassian.net." Not "Invalid input".

## Where the app uses it

- Connect step fields and their inputs: `FieldsStep` in `packages/web/src/connect-steps.tsx`. CSS `.connect-field`, `.connect-hint`, `.connect-details .input` and `.input[aria-invalid]` in `window.css`.
- The first run's API key: `ApiKey` in `packages/web/src/setup-page.tsx`.
- Settings: the path `CliPath` in `packages/web/src/settings-page.tsx`, the API key `ApiKey` in `packages/web/src/settings-page.tsx`, a connection's name `Options` in `packages/web/src/connections-page.tsx` and a list option `ListOption` in `packages/web/src/connections-page.tsx`. CSS `.settings :is(.input, .select)`, `.settings .input` and `.settings :is(.input, .select):focus-visible` in `window.css`.
- Folder path: `FolderStep` in `packages/web/src/connect-steps.tsx`. CSS `.path-label`, `.path-label input`, `.path-actions` and `.path-note` in `window.css`.
- Review link page: `ReviewChange` in `packages/web/src/other-pages.tsx`. CSS `.name-field`, `.name-field.reason` and `.name-field input` in `window.css`.
- Held field: `HeldMessage` in `packages/web/src/thread-page.tsx`, and a draft's option `DraftCard` in `packages/web/src/thread-page.tsx`. CSS `.held-field` in `window.css`.
- Review link: `ChangeSet` in `packages/web/src/thread-page.tsx`. CSS `.link-field` in `window.css`.
- Workstream's name: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`. CSS `.workstream-title`, `.workstream-title:hover` and `.workstream-title:focus` in `window.css`.

## Search

Two searches filter what's on the page and never reach the agent: the sidebar's thread search, and Browse's item search. Each is a `<label>` drawn as the field's frame, holding the search icon, a visually hidden name and a borderless input. The input turns its own ring off, and the frame shows focus instead, with a `--focus` border and a 1px ring (`:focus-within`). The two rules are byte for byte the same (`.sidebar-search-field` and `.filter-search` in `window.css`) apart from how much room each takes.

```html specimen id=search-sidebar title="The sidebar's thread search (a combobox)"
<div class="sidebar-search-row">
  <label class="sidebar-search-field">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search threads</span>
    <input
      id="sidebar-search"
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search threads"
      aria-expanded="false"
      aria-controls="sidebar-search-list"
      aria-autocomplete="list"
    />
  </label>
</div>
```

```html specimen id=search-browse title="Browse's item search, before its filters"
<form class="filters" role="search" aria-label="Filter items">
  <label class="filter-search">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search items</span>
    <input
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search items by key, title or text"
      maxlength="200"
    />
  </label>
</form>
```

```html specimen id=search-focus title="Focus: the frame rings, not the input" state=focus-within
<form class="filters" role="search" aria-label="Filter items">
  <label class="filter-search ws-focus-within">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search items</span>
    <input type="search" value="wallet" placeholder="Search items by key, title or text" />
  </label>
</form>
```

- **The sidebar's**, `ThreadSearch` in `packages/web/src/sidebar.tsx`, is a combobox over a listbox of threads found: ArrowDown and ArrowUp move through them, Enter opens one, Escape clears the field. Under it, a `role="status"` line says "{n} results", "No thread matches that." or "Oriel couldn't search just now. Keep typing to try again."
- **Browse's** is `type="search"` in a `<form role="search">` with the filters. It asks once typing pauses; Enter doesn't wait.
- Two more search boxes don't use this frame: a connector's pick step and a connection's option list put a plain `.input type="search"` above their radios (`PickStep` in `packages/web/src/connect-steps.tsx`, `PickOption` in `packages/web/src/connections-page.tsx`).
- Copy `.sidebar-search-field`'s markup for a new search until one `SearchField` replaces both.

## Drift

Status **drifting**. About nine field looks for one job:

- **Heights:** 2.25rem in connect steps, 1.875rem in Settings and the searches, `--head-row` for the workstream's name, and three padding-only sizes (0.125rem, 0.1875rem, 0.3125rem) elsewhere.
- **Borders:** `--line` on the searches and the review link, `--line-strong` on the rest.
- **Focus:** four looks. The global ring 2px out; the ring at 0 offset in Settings; a ringed frame on the searches; a border change alone on the workstream's name, which is the weakest focus of any field.
- **The input class depends on its ancestor.** Outside `.settings`, `.connect-details`, `.connect-pick` or `.setup-form` it has no box at all. `.connect-field input` in `window.css` is always beaten by `.connect-details .input` in `window.css`, so most of it is dead. `.settings .input` sets the mono face and a later rule undoes it for connections (`.settings :is(.connection-options, .connect-details, .connect-pick) .input` in `window.css`).
- **Labels:** five wrappers (`.settings-field`, `.connect-field`, `.provider-path-label`, `.path-label`, `.name-field`) do one job, the last four almost the same rule.
- **Errors:** only connect steps mark the field. Nothing ties a hint or a problem to its field.
- **Searches:** `.sidebar-search-field` and `.filter-search` are copies of each other.

**Until a Field and an Input component land, copy the connect step's field** (`FieldsStep` in `packages/web/src/connect-steps.tsx`): a wrapping `<label class="connect-field">` with `.connect-label`, an `.input` inside a `.connect-details` form, an optional `.connect-hint`, `aria-invalid` on the field that's wrong and one `.connect-problem` line. It has the biggest target, a real label, and the only error state. Inside Settings, use `.settings-field` and `.input` as Settings does. The [drift report](/drift) has the `Field` and `SearchField` proposals, and the [lab](/lab/text-field) shows them in modern CSS.
