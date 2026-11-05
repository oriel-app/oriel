---
title: Text field
status: proposed
order: 40
classes: text-field, text-field-label, text-field-hint, text-field-problem, text-field-input, search-field, search-field-input, connect-details, connect-fields, connect-field, connect-label, connect-hint, connect-problem, input, settings, provider-path-label, held-message, held-by, held-field, name-field, reason, link-field, sidebar-search-field, filter-search, icon, visually-hidden
summary: One Field (label, hint and problem tied with aria-describedby) for Oriel's nine field styles, textareas that grow with field-sizing, :user-invalid beside aria-invalid, and one SearchField.
---

# Text field

## What it is

A place to type one value: a name, an address, a key, a path, a reason. Oriel has about nine field styles and no field class. Each page sets its own border, height and padding, the label and hint are four different pairs of classes, and no problem is tied to its field for a screen reader.

The proposal is two pieces:

- **Field** (`.text-field`): a label, the control (`.text-field-input`, an `<input>` or a `<textarea>`), an optional hint and an optional problem. The hint and the problem are tied to the control with `aria-describedby`. Focus is the field focus: the border and a ring in `--focus`, the same as the [ChatInput proposal](/components/chat-input) and the sidebar's search today. A textarea grows with `field-sizing: content`. A wrong field is `[aria-invalid]` or `:user-invalid`.
- **SearchField** (`.search-field`): the framed search with its icon. The sidebar's and Browse's searches are two copies of one style today; this is that style, once.

The [chat input](/components/chat-input) isn't a text field: it asks, and has its own proposal. A [select](/lab/select) picks from a list.

## Today

Oriel's markup and CSS. Compare the heights, the labels, and where a problem sits.

```html specimen id=today-connect title="The connect steps: .connect-field, .input, .connect-problem (FieldsStep, in connect-steps.tsx)" side=today
<form class="connect-details" aria-label="Your Jira account">
  <div class="connect-fields">
    <label class="connect-field">
      <span class="connect-label">Your Jira address</span>
      <input
        class="input"
        type="text"
        value="yourteam"
        placeholder="yourteam.atlassian.net"
        aria-invalid="true"
      />
      <span class="connect-hint">The start of the address in your browser when Jira is open.</span>
    </label>
    <label class="connect-field">
      <span class="connect-label">The email you sign in to Jira with</span>
      <input class="input" type="email" placeholder="you@company.com" />
    </label>
  </div>
  <p class="connect-problem" role="alert">Type your Jira address, like yourteam.atlassian.net.</p>
</form>
```

```html specimen id=proposed-connect title="The connect steps as Fields: the problem under its field, and tied to it" side=proposed
<form class="connect-details" aria-label="Your Jira account">
  <div class="connect-fields">
    <div class="text-field">
      <label class="text-field-label" for="jira-site">Your Jira address</label>
      <input
        id="jira-site"
        class="text-field-input"
        data-size="lg"
        type="text"
        value="yourteam"
        placeholder="yourteam.atlassian.net"
        aria-invalid="true"
        aria-describedby="jira-site-hint jira-site-problem"
      />
      <span class="text-field-hint" id="jira-site-hint"
        >The start of the address in your browser when Jira is open.</span
      >
      <p class="text-field-problem" id="jira-site-problem" role="alert">
        Type your Jira address, like yourteam.atlassian.net.
      </p>
    </div>
    <div class="text-field">
      <label class="text-field-label" for="jira-email">The email you sign in to Jira with</label>
      <input
        id="jira-email"
        class="text-field-input"
        data-size="lg"
        type="email"
        placeholder="you@company.com"
      />
    </div>
  </div>
</form>
```

```html specimen id=today-settings title="Settings: a path, in .settings .input (CliPath, in settings-page.tsx)" side=today
<div class="settings">
  <label class="provider-path-label">
    <span>Path to Claude Code</span>
    <input type="text" class="input" placeholder="/opt/homebrew/bin/claude" spellcheck="false" />
  </label>
</div>
```

```html specimen id=proposed-settings title="Settings' path as a Field, in mono" side=proposed
<div class="text-field">
  <label class="text-field-label" for="claude-path">Path to Claude Code</label>
  <input
    id="claude-path"
    type="text"
    class="text-field-input"
    data-mono
    placeholder="/opt/homebrew/bin/claude"
    spellcheck="false"
  />
</div>
```

```html specimen id=today-held title="A held message's edit: .held-field, rows=3 (HeldMessage, in thread-page.tsx)" side=today
<section class="held-message">
  <p class="held-by"><strong>Amara Okafor</strong> rejected this on the review link:</p>
  <textarea class="held-field" rows="3" maxlength="8000" aria-label="Edit Amara Okafor's reason">
SYN-23 can't ship without the saved cards step. Keep it in To do until design signs off on the wallet sheet.</textarea>
</section>
```

```html specimen id=proposed-held title="The edit as a Field: it grows with what's written" side=proposed
<section class="held-message">
  <p class="held-by"><strong>Amara Okafor</strong> rejected this on the review link:</p>
  <textarea
    class="text-field-input"
    rows="2"
    maxlength="8000"
    aria-label="Edit Amara Okafor's reason"
  >
SYN-23 can't ship without the saved cards step. Keep it in To do until design signs off on the wallet sheet.</textarea>
</section>
```

```html specimen id=today-review title="The review link page: .name-field (ReviewChange, in other-pages.tsx)" side=today
<form class="review-decide">
  <label class="name-field reason">
    If you reject it, what's wrong? (optional)
    <textarea rows="2" maxlength="2000"></textarea>
  </label>
  <label class="name-field">
    Your name
    <input maxlength="120" autocomplete="name" value="Amara Okafor" />
  </label>
</form>
```

```html specimen id=proposed-review title="The review link page as Fields" side=proposed
<form class="review-decide">
  <div class="text-field name-field reason">
    <label class="text-field-label" for="review-reason"
      >If you reject it, what's wrong? (optional)</label
    >
    <textarea id="review-reason" class="text-field-input" rows="2" maxlength="2000"></textarea>
  </div>
  <div class="text-field name-field">
    <label class="text-field-label" for="review-name">Your name</label>
    <input
      id="review-name"
      class="text-field-input"
      maxlength="120"
      autocomplete="name"
      value="Amara Okafor"
    />
  </div>
</form>
```

The review page's two proposed fields keep `.name-field` for its place in the row (`flex: 1 1 12rem`, and a whole row for the reason); the Field draws the rest.

### Search

The sidebar's search and Browse's are the same frame, written twice (`.sidebar-search-field` and `.filter-search` in `window.css`): a `--line` border, the icon in `--text-faint`, and the field focus on the frame.

```html specimen id=today-search title="Today: the sidebar's search, and Browse's" side=today
<div class="ws-stack">
  <label class="sidebar-search-field">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search threads</span>
    <input type="text" autocomplete="off" spellcheck="false" placeholder="Search threads" />
  </label>
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
</div>
```

```html specimen id=proposed-search title="Proposed: one SearchField, twice" side=proposed
<div class="ws-stack">
  <label class="search-field">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search threads</span>
    <input
      class="search-field-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search threads"
    />
  </label>
  <label class="search-field">
    <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </svg>
    <span class="visually-hidden">Search items</span>
    <input
      class="search-field-input"
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search items by key, title or text"
      maxlength="200"
    />
  </label>
</div>
```

The sidebar's input is also a `combobox` over its results (`ThreadSearch` in `packages/web/src/sidebar.tsx`); that's the [sidebar](/components/sidebar)'s behaviour, not the field's, and its attributes go on `.search-field-input` unchanged.

## Proposed

```html specimen id=anatomy title="Anatomy: label, control, hint, problem" side=proposed
<div class="text-field">
  <label class="text-field-label" for="anat-token">API token</label>
  <input
    id="anat-token"
    class="text-field-input"
    type="password"
    placeholder="Paste it here"
    autocomplete="off"
    aria-describedby="anat-token-hint"
  />
  <span class="text-field-hint" id="anat-token-hint"
    >Atlassian shows it only once. Oriel keeps it encrypted on this Mac.</span
  >
</div>
```

- **`.text-field`**: a grid, `--space-1` between its parts. It sets `accent-color: var(--accent)`, inherited, so a checkbox or radio inside a field (a "Show key" box, a choice under a field) wears the accent without a rule of its own. Today the connect steps' radio rows (`PickStep` in `packages/web/src/connect-steps.tsx`) have none.
- **`.text-field-label`**: a `<label for>`, in `--text`, medium weight. Not a `<label>` around everything: the hint and the problem would join the field's name.
- **`.text-field-input`**: 1.875rem high at least, `--line-strong`, `--radius`, `--surface`, `--text-md`. `data-size="lg"` is 2.25rem, for the first run and the connect steps; `data-mono` is for a path, a key or a command.
- **`.text-field-hint`**: `--text-faint`, `--text-sm`. Say what to type, or where to find it.
- **`.text-field-problem`**: `--danger`, `--text-sm`, `role="alert"`, directly under its field. A problem about the whole form (Jira refused the address and the token together) stays one line under the form, and marks each field it names with `aria-invalid`.
- **Placeholder**: `--text-faint` at full opacity (Firefox fades placeholders by default). It's an example of the value ("you@company.com"), never the label.

### Growing textareas

Two textareas grow by different means today. The composer uses `field-sizing: content` (`.composer textarea` in `window.css`). A draft's option counts the drafted text's lines in JS, from two to eight (`DraftCard` in `packages/web/src/thread-page.tsx`), once: it doesn't grow while the person types. A held message's edit is three rows, then a resize handle.

The proposal: every `textarea.text-field-input` grows, from two lines to eight, then scrolls, with `field-sizing: content` inside `@supports`. The floor and the ceiling are in `lh`, so they follow the text size. Where the engine has no `field-sizing`, the `rows` attribute holds and the handle stays (`resize: vertical`). Type in the specimen to see it.

```html specimen id=grow title="Grows while you type: two lines empty, eight at most" side=proposed
<div class="text-field">
  <label class="text-field-label" for="grow-reason"
    >If you reject it, what's wrong? (optional)</label
  >
  <textarea id="grow-reason" class="text-field-input" rows="2" maxlength="2000"></textarea>
</div>
```

```html specimen id=grow-long title="Written, it fits what's there" side=proposed
<div class="text-field">
  <label class="text-field-label" for="grow-long-reason">Edit Amara Okafor's reason</label>
  <textarea id="grow-long-reason" class="text-field-input" rows="2" maxlength="8000">
SYN-23 can't ship without the saved cards step.
Keep it in To do until design signs off on the wallet sheet.
Gift cards can go ahead on their own.</textarea>
</div>
```

## States

Forced with `ws-` classes, which carry each sheet's own `:hover` and `:focus-visible` rules. Click into any field to see the real focus.

```html specimen id=today-focus title="Today: focus on .input, .held-field and the review page's field" side=today state=focus
<div class="ws-stack">
  <div class="connect-details">
    <label class="connect-field">
      <span class="connect-label">Your Jira address</span>
      <input class="input ws-focus-visible" placeholder="yourteam.atlassian.net" />
    </label>
  </div>
  <textarea class="held-field ws-focus-visible" rows="2" aria-label="Edit Amara Okafor's reason">
Keep it in To do.</textarea>
</div>
```

```html specimen id=proposed-focus title="Proposed: the field focus, the same on every field" side=proposed state=focus
<div class="ws-stack">
  <div class="text-field">
    <label class="text-field-label" for="focus-site">Your Jira address</label>
    <input
      id="focus-site"
      class="text-field-input ws-focus-visible"
      data-size="lg"
      placeholder="yourteam.atlassian.net"
    />
  </div>
  <textarea
    class="text-field-input ws-focus-visible"
    rows="2"
    aria-label="Edit Amara Okafor's reason"
  >
Keep it in To do.</textarea>
</div>
```

```html specimen id=today-search-focus title="Today: the search frames' focus" side=today state=focus
<label class="filter-search ws-focus-within">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </svg>
  <span class="visually-hidden">Search items</span>
  <input type="search" placeholder="Search items by key, title or text" value="wallet" />
</label>
```

```html specimen id=proposed-search-focus title="Proposed: the same focus, on .search-field" side=proposed state=focus
<label class="search-field ws-focus-within">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </svg>
  <span class="visually-hidden">Search items</span>
  <input
    class="search-field-input"
    type="search"
    placeholder="Search items by key, title or text"
    value="wallet"
  />
</label>
```

```html specimen id=today-invalid title="Today: aria-invalid, the problem under the form" side=today state=error
<div class="connect-details">
  <label class="connect-field">
    <span class="connect-label">API token</span>
    <input class="input" type="password" value="abc" aria-invalid="true" />
  </label>
  <p class="connect-problem" role="alert">
    Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If
    it is, make a new one (step 2) and paste it here.
  </p>
</div>
```

```html specimen id=proposed-invalid title="Proposed: aria-invalid, the problem tied to the field" side=proposed state=error
<div class="text-field">
  <label class="text-field-label" for="inv-token">API token</label>
  <input
    id="inv-token"
    class="text-field-input"
    data-size="lg"
    type="password"
    value="abc"
    aria-invalid="true"
    aria-describedby="inv-token-problem"
  />
  <p class="text-field-problem" id="inv-token-problem" role="alert">
    Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If
    it is, make a new one (step 2) and paste it here.
  </p>
</div>
```

```html specimen id=user-invalid title="Proposed: :user-invalid, real. Type amara, then leave the field" side=proposed state=error
<div class="text-field">
  <label class="text-field-label" for="ui-email">The email you sign in to Jira with</label>
  <input
    id="ui-email"
    class="text-field-input"
    data-size="lg"
    type="email"
    required
    placeholder="you@company.com"
  />
</div>
```

```html specimen id=today-off title="Today: disabled and read-only" side=today state=disabled
<div class="ws-stack">
  <textarea class="held-field" rows="2" disabled aria-label="Edit Amara Okafor's reason">
Keep it in To do.</textarea>
  <input
    class="link-field"
    readonly
    value="http://localhost:4310/review/7f3c9a2e"
    aria-label="Review link"
  />
</div>
```

```html specimen id=proposed-off title="Proposed: disabled at half strength; read-only sunk" side=proposed state=disabled
<div class="ws-stack">
  <textarea class="text-field-input" rows="2" disabled aria-label="Edit Amara Okafor's reason">
Keep it in To do.</textarea>
  <input
    class="text-field-input"
    data-mono
    readonly
    value="http://localhost:4310/review/7f3c9a2e"
    aria-label="Review link"
  />
</div>
```

- **Rest:** `--line-strong` border on `--surface`; the placeholder in `--text-faint`.
- **Hover:** nothing. A field doesn't change under the pointer; the cursor says it takes text.
- **Focus:** the field focus, the border and a 1px ring in `--focus`, shown on a click as well as the keyboard (the caret is there). Today it's the window's 2px outline on most fields, a ring on the searches, and `outline: none` on the workstream's title.
- **Filled:** the value in `--text`. A textarea fits its text, two lines to eight.
- **Error:** a `--danger` border, and the ring in `--danger` while focused. From `aria-invalid="true"` (what the reducer or the server said), or `:user-invalid` (what the browser knows: `required`, `type="email"`, `maxlength`, `pattern`), which waits until the person has typed and left the field, so an empty form isn't red on arrival. The problem's words come from Oriel either way; `:user-invalid` only colours the border.
- **Disabled:** half strength, as a button. A held message's edit is disabled while it's being settled. Today no field has a disabled style.
- **Read-only:** sunk (`--surface-sunk`), in `--text-muted`: it's there to be copied, not typed in. The review link is the one today.
- **Busy, empty:** not a field's own. A form that's sending disables its submit button.

## Keyboard and ARIA

- A field is a native `<input>` or `<textarea>`: Tab in and out, typing, selection, undo and paste are the browser's. Nothing is scripted.
- **Enter** submits a form with one text input (the connect steps' "Next", the review page's approve). In a textarea it's a new line.
- **Escape** clears a `type="search"` field in Chrome and Safari. The sidebar's search uses `type="text"` with `role="combobox"`, and its Escape is its own (`ThreadSearch` in `packages/web/src/sidebar.tsx`).
- **Name:** the `<label for>`. A field with no visible label (the searches, a held message's edit) has a visually hidden one or an `aria-label`. Never only a placeholder.
- **Description:** `aria-describedby` lists the hint and the problem, in that order, by id. A screen reader reads them after the name and the value. Today no problem is tied to its field.
- **Error:** `aria-invalid="true"` on the field, and the problem `role="alert"`, so it's read when it appears. When the form's problem names several fields, each gets `aria-invalid`, and focus goes to the first.
- **Required:** `required` on the field, and "(optional)" in the label of the ones that aren't, as the review page does. Don't mark required fields with an asterisk.

## Support and fallback

| Feature                                       | Chromium | Desktop (Chromium 156) | Safari / Firefox                       | Fallback                                                                                        |
| --------------------------------------------- | -------- | ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `field-sizing: content`                       | 123      | Yes                    | Safari 26.2, Firefox 152               | The `rows` attribute and a resize handle. It sits in `@supports`, so an older engine keeps both |
| `lh` unit (the 2-to-8-line floor and ceiling) | 109      | Yes                    | Safari 16.4, Firefox 120               | Inside the same `@supports`, so never seen without `field-sizing`                               |
| `:user-invalid`                               | 119      | Yes                    | Safari 16.5, Firefox 88                | `[aria-invalid]` still holds; `:is()` forgives an unknown pseudo-class                          |
| `accent-color`                                | 93       | Yes                    | Safari 15.4, Firefox 92                | The system's blue                                                                               |
| `::placeholder` with `opacity: 1`             | 57       | Yes                    | All                                    | n/a                                                                                             |
| `:focus-visible`                              | 86       | Yes                    | All                                    | n/a                                                                                             |
| `:focus-within` (SearchField)                 | 60       | Yes                    | All                                    | n/a                                                                                             |
| `::-webkit-search-cancel-button`              | All      | Yes                    | Safari yes; Firefox has no such button | n/a                                                                                             |

This sheet reaches the review link page, which may open in Safari or Firefox. Everything in it is either Baseline or inside `@supports`, so the review page's two fields look the same everywhere, and its reason field grows where the engine can and keeps two rows and a handle where it can't.

What was tried:

- **Chrome 156, headless:** the empty textarea is two lines high, and typing ten lines makes it eight lines high, then it scrolls. `:user-invalid` doesn't match an empty required email field on arrival; after typing "amara" and pressing Tab it matches, and the border is `--danger`. `CSS.supports("field-sizing: content")` is true.
- **Firefox 142, headless** (before Firefox had `field-sizing`): the textareas keep their `rows` and the resize handle; borders, radius, focus and placeholder match Chrome's.

## Adopt now or wait

**Adopt now.** Every feature here works in the desktop app and either works or falls back in Safari and Firefox, including on the review page. The wins: one field style instead of nine, problems a screen reader can find, a held message's edit and a draft's option that grow as the person types, and one search frame instead of two copies.

Adopt `:user-invalid` with care: only fields with real constraints (`type="email"`, `required`) ever match it. Oriel's own checks (Jira refused the token) still come back as `aria-invalid`.

## How to migrate

1. Add `field.css`'s rules to `window.css`, beside `.input[aria-invalid]` in `window.css`.
2. **Connect steps**, `FieldsStep` in `packages/web/src/connect-steps.tsx`: each `<label class="connect-field">` becomes a `.text-field` with a `<label for>`, the input `class="text-field-input" data-size="lg"`, and `aria-describedby` naming the hint and, when its name is in `form.fields`, the problem. The first run's key is the same shape (`ApiKey` in `packages/web/src/setup-page.tsx`). Then delete `.connect-field input`, `.connect-hint`, `.connect-details .input` and `.connect-problem` in `window.css`, the last of them both times it's written.
3. **Settings and connections**: `class="text-field-input" data-mono` on the path and key inputs (`CliPath` and `ApiKey` in `packages/web/src/settings-page.tsx`), plain on the name (`Options` in `packages/web/src/connections-page.tsx`). Delete `.settings .input` in `window.css`, and the `.input` half of `.settings :is(.input, .select)` beside it.
4. **Textareas**: `class="text-field-input"` on the held message's edit (`HeldMessage` in `packages/web/src/thread-page.tsx`) and a draft's option (`DraftCard` in `packages/web/src/thread-page.tsx`), with `rows={2}`; delete `DraftCard`'s line count and `.held-field` in `window.css`. The review page's reason and name (`ReviewChange` in `packages/web/src/other-pages.tsx`) keep `.name-field` for their place in the row; delete `.name-field input` and `.name-field textarea` in `window.css`.
5. **The review link** (`ChangeSet` in `packages/web/src/thread-page.tsx`): `class="text-field-input" data-mono readonly`. Keep `.link-field`'s `--text-xs` if the link must stay that small.
6. **SearchField**: `class="search-field"` on the sidebar's `<label>` (`ThreadSearch` in `packages/web/src/sidebar.tsx`) and Browse's (`Filters` in `packages/web/src/window-page.tsx`), `class="search-field-input"` on their inputs. Delete `.sidebar-search-field` and `.filter-search` in `window.css`, with their `:focus-within`, `input` and placeholder rules. Keep the sidebar's folded rule, `.shell[data-folded] :is(.sidebar-search-field, .search-results)` in `window.css`, and point it at `.search-field`.
7. Shots to retake: the first run's key step, Connect Jira, Settings › Providers, a thread with a held message and a draft, the review link page, the sidebar and Browse, in each theme.
