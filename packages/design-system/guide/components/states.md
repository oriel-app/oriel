---
title: Empty, loading and error
status: drifting
group: Feedback
order: 70
classes: rail-empty, rail-note, window-chat-empty, no-items, no-matches, overview-quiet, panel-empty, connect-none, loading, overview-loading, more-items, panel-read, working, working-dot, spinner, cli-waiting, failed, notice, overview-problem, connect-problem, connection-problem, source-problem, selection-notice, panel-problem, change-set-problem, settings-problem, setup-problem, run-error, line-error, apply-errors
summary: The lines that say there's nothing here, it's on its way, or it didn't work. Nine empty classes, five loading looks and about 22 error classes today; which to copy.
---

# Empty, loading and error

## What it is

The short lines Oriel shows in place of content, or beside it, when there's nothing to show yet:

- **Empty:** there's nothing here, and (at best) how it gets here. "No items. Add some from the window."
- **Loading and working:** it's on its way. "Loading…", "Working…", "Syncing…".
- **Error:** it didn't work, and what to do. "The window didn't load." with Try again.

None of them is a component today. Each page has its own class for each, so there are nine classes for empty, five looks for loading, and about 22 classes for an error, in three colours. This page shows them all, with Oriel's own words, and says which to copy.

Most error text comes from the server: `errorOf` in `packages/web/src/http.ts` shows the server's sentence as it is, or "Something went wrong. Try again." when it sends none. A request that never reached Oriel says "Oriel can't be reached. Is it still running?" (`unreachable` in `packages/web/src/http.ts`). Some empty and waiting sentences come from the connector, not the window (decision 0049).

## When to use it

- **Empty** wherever a list or a section can have nothing in it. Say what's missing, and how it gets here, in one or two sentences. Offer the way out as a quiet action when there is one ("Clear filters"), or a link ("Browse").
- **Loading** for the first load of a page or a part of one. **Working** while the agent runs. **Waiting** (a spinner) while Oriel waits on something outside it: the system, a browser sign-in, a download.
- **Error** in the place where the thing failed: under the control, at the foot of the card, in place of the page that didn't load. With a way to try again where trying again could work.

## When not to

- Not an empty state where the section can simply not show. "When nothing waits, nothing shows" (`NeedsYou` in `packages/web/src/sidebar.tsx`): Needs you is absent, not empty.
- Not "Loading…" for something quick inside a control. A busy button changes its label instead ("Connecting…"); see [Button](/components/button).
- Not an error colour for something that isn't wrong. "That's already in this workstream." is news, not a failure.
- Not a toast for an error. Oriel's only floating note is [the bead](/components/bead), and its failure is for what failed doing or undoing what it notes, or a close from a list.
- Not a generic sentence. "Something went wrong" is the fallback, never what to write.

## Anatomy and variants

### Empty

| Class                  | Where                               | Oriel's words                                                                                                                           | Look                       |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `.rail-empty`          | a workstream's items, the Done page | "No items. Add some from the window." (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`)                                      | faint, page size           |
| `.sidebar .rail-empty` | the sidebar's workstreams and Done  | "Pick items in the window, or make a workstream from a cluster." (`Workstreams` in `packages/web/src/sidebar.tsx`)                      | faint, `--text-sm`         |
| `.rail-note`           | a thread's right rail               | "No items yet. What a change set here creates joins this workstream." (`Region` in `packages/web/src/thread-page.tsx`)                  | faint, `--text-sm`         |
| `.window-chat-empty`   | the window chat, before a question  | "Ask about what changed, what needs you, or what should become a workstream." (`WindowChat` in `packages/web/src/window-chat-view.tsx`) | muted, `--text-md`         |
| `.no-items`            | an opened Browse cluster            | "None of its items match." / "No items." (`Items` in `packages/web/src/window-page.tsx`)                                                | faint, a sunk band         |
| `.no-matches`          | Browse, filtered to nothing         | "Nothing in the window matches these filters." + Clear filters (`Body` in `packages/web/src/window-page.tsx`)                           | muted, `--space-6` margins |
| `.overview-quiet`      | an overview section                 | "Nobody has work in progress." (`People` in `packages/web/src/overview-page.tsx`)                                                       | muted, `--text-md`         |
| `.panel-empty`         | a block in the item panel           | the source's own: "No comments." (`jiraPanel` in `packages/jira/src/panel.ts`)                                                          | faint, `--text-sm`         |
| `.connect-none`        | a review step with no guess         | "Oriel couldn't guess: no column has a different value in every row." (`ReviewStep` in `packages/web/src/connect-steps.tsx`)            | muted                      |

And one borrowed class: Settings › Connections says "Nothing is connected yet." in a `.settings-field-about` (`Connections` in `packages/web/src/connections-page.tsx`).

```html specimen id=empty title="Empty, each as its page draws it"
<div class="ws-stack">
  <div>
    <p class="ws-note">A workstream with no items (.rail-empty):</p>
    <p class="rail-empty">No items. Add some from the window.</p>
  </div>
  <div>
    <p class="ws-note">The Done page (.rail-empty):</p>
    <p class="rail-empty">
      No thread is done yet. One is once its change set is applied, or you mark it done.
    </p>
  </div>
  <div>
    <p class="ws-note">A thread's right rail (.rail-note):</p>
    <p class="rail-note">No items yet. What a change set here creates joins this workstream.</p>
  </div>
  <div>
    <p class="ws-note">The overview (.overview-quiet), with its way out:</p>
    <p class="overview-quiet">
      No workstreams yet. Make one from what isn't in a workstream yet, or from
      <a href="/window">Browse</a>.
    </p>
  </div>
  <div>
    <p class="ws-note">Browse, filtered to nothing (.no-matches):</p>
    <p class="no-matches">
      Nothing in the window matches these filters.
      <button type="button" class="quiet-action">Clear filters</button>
    </p>
  </div>
  <div>
    <p class="ws-note">The window chat, before a question (.window-chat-empty):</p>
    <ol class="chat">
      <li class="window-chat-empty">
        Ask about what changed, what needs you, or what should become a workstream.
      </li>
    </ol>
  </div>
  <div>
    <p class="ws-note">An item's comments, in the panel (.panel-empty):</p>
    <p class="panel-empty">No comments.</p>
  </div>
  <div>
    <p class="ws-note">A review step with no guess (.connect-none):</p>
    <p class="connect-none">
      Oriel couldn't guess: no column has a different value in every row. Add one, such as an ID, in
      the sheet, then try again.
    </p>
  </div>
</div>
```

```html specimen id=empty-cluster title="An opened Browse cluster with nothing in it (.no-items)"
<div class="clusters">
  <section class="cluster" data-open>
    <h2 class="cluster-head">
      <button type="button" class="cluster-toggle" aria-expanded="true" aria-controls="items-gift">
        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
        <span class="cluster-name"><span class="cluster-label">Gift cards</span></span>
        <span class="cluster-details">
          <span class="cluster-meta"><span class="count">0 of 6 items</span></span>
        </span>
      </button>
    </h2>
    <p class="no-items" id="items-gift">None of its items match.</p>
  </section>
</div>
```

### Loading and working

| Look                              | Where                               | Oriel's words                                                                     | Mark            | Read out        |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- | --------------- | --------------- |
| `.loading`                        | a page's first load                 | "Loading…" (`ThreadPage` in `packages/web/src/thread-page.tsx`)                   | none            | no              |
| `.overview-loading`               | the overview                        | "Loading the overview…" (`OverviewPage` in `packages/web/src/overview-page.tsx`)  | none            | no              |
| `.more-items[data-state=loading]` | a page of a Browse cluster's items  | "Loading…" (`More` in `packages/web/src/window-page.tsx`)                         | none, sunk band | no              |
| `.panel-read`                     | the item panel, reading again       | "Reading again…" (`ItemPanel` in `packages/web/src/item-panel.tsx`)               | none            | `role="status"` |
| `.working` + `.working-dot`       | a thread, the window chat           | "Working…" (`ThreadPage` in `packages/web/src/thread-page.tsx`)                   | pulsing dot     | `role="status"` |
| `.cli-waiting` + `.spinner`       | Providers, connect steps, first run | "Looking for it on this Mac…" (`ClaudeCodeRow` in `packages/web/src/cli-row.tsx`) | spinner         | `role="status"` |
| "Syncing…" in `.sources-line`     | the sidebar's Sources               | "Syncing…" (`Sources` in `packages/web/src/sidebar.tsx`)                          | accent text     | no              |

The thread rail's Sync now button pulses its icon while it syncs (`.sync-now[aria-busy] .icon` in `window.css`).

```html specimen id=loading title="Loading and working, each as its page draws it"
<div class="ws-stack">
  <div>
    <p class="ws-note">A page's first load (.loading):</p>
    <p class="loading">Loading…</p>
  </div>
  <div>
    <p class="ws-note">The overview (.overview-loading):</p>
    <p class="overview-loading">Loading the overview…</p>
  </div>
  <div>
    <p class="ws-note">The item panel (.panel-read):</p>
    <p class="panel-read" role="status">Reading again…</p>
  </div>
  <div>
    <p class="ws-note">The agent, in a thread or the window chat (.working):</p>
    <ol class="chat">
      <li class="working" role="status"><span class="working-dot"></span> Working…</li>
    </ol>
  </div>
  <div>
    <p class="ws-note">Waiting on something outside Oriel (.cli-waiting):</p>
    <p class="cli-line cli-waiting" role="status">
      <span class="spinner" aria-hidden="true"></span>Waiting for the folder you choose…
    </p>
  </div>
  <div>
    <p class="ws-note">The sidebar's Sources, syncing:</p>
    <section class="sidebar-sources" aria-label="Sources" data-syncing>
      <span class="sources-line">Syncing…</span>
    </section>
  </div>
</div>
```

```html specimen id=loading-more title="A page of items on its way, in a Browse cluster"
<div class="clusters">
  <section class="cluster" data-open>
    <div class="items-loading">
      <p class="more-items" data-state="loading">Loading…</p>
    </div>
  </section>
</div>
```

### Error

Inline lines, under or beside what failed, in `--danger` at `--text-sm` unless noted:

| Class                      | Where                              | Example of what it says                                                                                                        | Role  |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `.chat-input-notice`       | every chat input                   | the server's (`ChatInput` in `packages/web/src/chat-input.tsx`)                                                                | alert |
| `.notice[data-tone=error]` | a workstream's page                | "Nothing that was dropped names an item. Drop an item, or a link to one." (`nothingToAdd` in `packages/web/src/workstream.ts`) | alert |
| `.connect-problem`         | a connect step, the first run      | "Type the folder's full path, starting with / or ~." (`folderConnect` in `packages/folder/src/connecting.ts`)                  | alert |
| `.connection-problem`      | a connection in Settings           | the server's (`ConnectionRow` in `packages/web/src/connections-page.tsx`)                                                      | alert |
| `.source-problem`          | a source in the sidebar            | the server's (`Sources` in `packages/web/src/sidebar.tsx`)                                                                     | alert |
| `.selection-notice`        | Browse's picked-items bar          | the server's (`Selection` in `packages/web/src/window-page.tsx`)                                                               | alert |
| `.panel-problem`           | the item panel, with Try again     | the server's (`ItemPanel` in `packages/web/src/item-panel.tsx`)                                                                | alert |
| `.confirm-problem`         | the confirm dialog, page size      | the server's (`Confirm` in `packages/web/src/close-thread.tsx`)                                                                | alert |
| `.run-error`               | a run's script, page size          | the script's error (`Run` in `packages/web/src/thread-page.tsx`)                                                               | none  |
| `.line-error`              | a change set's line                | the source's, with "Remove this change" (`Diff` in `packages/web/src/thread-page.tsx`)                                         | note  |
| `.apply-errors`            | a change set, while its diff loads | each line's error (`ChangeSet` in `packages/web/src/thread-page.tsx`)                                                          | none  |
| `.overview-problem`        | the overview, **muted**, page size | the server's, with Try again (`OverviewPage` in `packages/web/src/overview-page.tsx`)                                          | alert |

Boxes and bands:

| Class                            | Where                       | Oriel's words                                                                                                                                                         | Look                                                 |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `.failed`                        | a page that didn't load     | "The window didn't load." + Try again (`Body` in `packages/web/src/window-page.tsx`); "This thread didn't load." (`ThreadPage` in `packages/web/src/thread-page.tsx`) | **muted** text in a bordered box                     |
| `.more-items[data-state=failed]` | a page of a cluster's items | "These items didn't load." + Try again (`More` in `packages/web/src/window-page.tsx`)                                                                                 | **muted**, sunk band                                 |
| `.settings-problem`              | the top of Settings         | the server's (`SettingsPage` in `packages/web/src/settings-page.tsx`)                                                                                                 | danger on `--danger-soft`                            |
| `.setup-problem`                 | the first run               | the server's (`SetupPage` in `packages/web/src/setup-page.tsx`)                                                                                                       | the same as `.settings-problem`                      |
| `.change-set-problem`            | a change set's foot         | "Type your name first." on a review link (`updateReview` in `packages/web/src/review.ts`)                                                                             | danger on `--danger-soft`, a band                    |
| `.bead-wrap[data-tone=problem]`  | a close from a list         | the server's, in the bead, with Dismiss (`closingProblem` in `packages/web/src/close-thread.tsx`)                                                                     | the bead's failure; see [The bead](/components/bead) |

```html specimen id=error-lines title="Inline error lines"
<div class="ws-stack">
  <div>
    <p class="ws-note">A connect step (.connect-problem):</p>
    <p class="connect-problem" role="alert">Type the folder's full path, starting with / or ~.</p>
  </div>
  <div>
    <p class="ws-note">A workstream's page (.notice data-tone=error):</p>
    <p class="notice" data-tone="error" role="alert">
      Nothing that was dropped names an item. Drop an item, or a link to one.
    </p>
  </div>
  <div>
    <p class="ws-note">The item panel, with its retry (.panel-problem):</p>
    <p class="panel-problem" role="alert">
      Oriel can't be reached. Is it still running?
      <button type="button" class="quiet-action">Try again</button>
    </p>
  </div>
  <div>
    <p class="ws-note">The overview, muted (.overview-problem):</p>
    <p class="overview-problem" role="alert">
      Oriel can't be reached. Is it still running?
      <button type="button" class="quiet-action">Try again</button>
    </p>
  </div>
</div>
```

```html specimen id=error-boxes title="Error boxes and bands"
<div class="ws-stack">
  <div>
    <p class="ws-note">A page that didn't load, Browse (.failed, with a .button):</p>
    <div class="failed" role="alert">
      <span>The window didn't load.</span>
      <button type="button" class="button">Try again</button>
    </div>
  </div>
  <div>
    <p class="ws-note">A page that didn't load, a thread (.failed, no retry):</p>
    <p class="failed" role="alert">This thread didn't load.</p>
  </div>
  <div>
    <p class="ws-note">Settings (.settings-problem):</p>
    <p class="settings-problem" role="alert">Something went wrong. Try again.</p>
  </div>
  <div>
    <p class="ws-note">A change set's foot, on a review link (.change-set-problem):</p>
    <p class="change-set-problem" role="alert">Type your name first.</p>
  </div>
</div>
```

```html specimen id=error-more title="A page of items that didn't load, in a Browse cluster"
<div class="clusters">
  <section class="cluster" data-open>
    <div class="items-loading">
      <p class="more-items" data-state="failed" role="alert">
        <span>These items didn't load.</span>
        <button type="button" class="button">Try again</button>
      </p>
    </div>
  </section>
</div>
```

## States

The lines themselves have no states; their actions have their buttons' states. Focus on a retry is the global ring:

```html specimen id=state-retry-focus title="Focus visible on Try again" state=focus-visible
<div class="ws-stack">
  <div class="failed" role="alert">
    <span>The window didn't load.</span>
    <button type="button" class="button ws-focus-visible">Try again</button>
  </div>
  <p class="no-matches">
    Nothing in the window matches these filters.
    <button type="button" class="quiet-action ws-focus-visible">Clear filters</button>
  </p>
</div>
```

- **Motion:** the working dot pulses (`@keyframes pulse` in `window.css`) and the spinner turns (`@keyframes turning` in `window.css`). Reduced motion stops both (`@media (prefers-reduced-motion: reduce)` in `window.css`).
- **While it loads,** the region that's loading carries `aria-busy="true"`: `main.overview`, `main.window`, `main.thread`, the item panel, a change set, a held message.
- **Kept in place while empty:** a live region that's always rendered, and empty until it has something to say, is read out when the words arrive. The review link page's `.read-only-note` does this for "Approving and applying…" (`.read-only-note` in `window.css`), and so does the sidebar search's count line.
- A failed load can sit above what's still shown: Browse shows "The window didn't load." over its last clusters, dimmed.

## Keyboard and ARIA

- **Errors** are `role="alert"`, so they're read out the moment they show. Exceptions today: `.run-error` and `.apply-errors` have no role, `.line-error` is `role="note"`, and the second `.connection-problem` sits inside a `role="alert"` line rather than being one.
- **Working and waiting** lines are `role="status"`, read out politely.
- **Loading** lines have no role, so a screen reader hears nothing until the content arrives. The region's `aria-busy` is all it gets.
- **Empty** lines have no role; they're read in the page's order like any text. The sidebar search's count line is the exception, `role="status"`.
- A retry is a real `<button>`, after the sentence, so the keyboard reaches it right after hearing what failed.
- Errors aren't tied to the control that failed with `aria-describedby` anywhere. See [Text field](/components/text-field).

## Content

- **Empty** says what isn't here and how it comes to be: "No thread is done yet. One is once its change set is applied, or you mark it done." Not "No data" or "Nothing to see here".
- **Loading** is "Loading…", or what's actually happening when that's more useful: "Reading current values…", "Looking for it on this Mac…", "Checking what it changed…". Always "…" (U+2026), never three dots.
- **Working** is "Working…", for the agent.
- **A load that failed** says what didn't load: "The window didn't load.", "This thread didn't load.", "These items didn't load."
- **An error** says what happened and what to do, in Oriel's or the connector's words: "Jira didn't accept these two together. Check the email is the one you sign in to Jira with. If it is, make a new one (step 2) and paste it here."
- **Retry** is "Try again". **Dismiss** for an error that stays until it's dismissed.
- Product copy is the product's; when you move a line onto a new class, keep its words.

## Where the app uses it

- Empty: `.rail-empty`, `.sidebar .rail-empty`, `.search-results .rail-empty:empty`, `.rail-note`, `.window-chat-empty`, `.no-items`, `.no-matches`, `.overview-quiet`, `.panel-empty` and `.connect-none` in `window.css`.
- Loading: `.loading`, `.more-items`, `.working`, `.working-dot` and `.spinner` in `window.css`. `Waiting` in `packages/web/src/cli-row.tsx`, copied into `ReviewStep` in `packages/web/src/connect-steps.tsx`, and `YourWork` in `packages/web/src/setup-page.tsx`.
- Error: `.failed`, `.notice`, `.source-problem`, `.selection-notice`, `.chat-input-notice`, `.run-error`, `.line-error`, `.apply-errors`, `.change-set-problem`, `.panel-problem`, `.overview-problem`, `.settings-problem`, `.setup-problem` and `.cli-box` in `window.css`; `.connect-problem` in `window.css`; `.connection-problem` twice in `window.css`.

## Drift

Status **drifting**.

- **Empty:** nine classes, two colours (`--text-faint` and `--text-muted`) and two sizes with no rule for which. `.rail-empty` is a right-rail name used on pages, in the sidebar, for search status and for "Deleted. Nothing lists it or its threads now, and its items stay in their sources." The rail itself uses `.rail-note`. Most empties offer no way out.
- **Loading:** two marks (pulse and spinner) and none. Only working and waiting lines are `role="status"`. `Waiting` exists in `cli-row.tsx` but isn't exported, so three copies are inline. "Reading current values…" uses the page-level `.loading`, page margins and all, inside a change set.
- **Error:**
  - Three colours: `--danger` text, `--danger` on `--danger-soft`, and muted grey for a load that failed (`.failed`, `.overview-problem`, `.more-items[data-state=failed]`), even though they're `role="alert"`.
  - Four retry styles: a `.button` Try again (Browse), a `.quiet-action` Try again (the overview, the item panel), no retry at all ("This thread didn't load.", "This workstream didn't load."), and Dismiss.
  - `.failed` is also used for "This thread was deleted." with `role="status"`: not a failure.
  - `.settings-problem` and `.setup-problem` are the same rule twice. `.connection-problem` is declared twice.
  - "That's already in this workstream." shows in the error colour.

**Which to copy today**, until `Empty`, `Busy` and `Problem` components land:

- **Empty:** a `<p class="rail-empty">` on a page, with the sentence and, where there is one, the way out as a `.quiet-action` after it, as `.no-matches` does. In the sidebar, the rail and the panel, use that place's own class.
- **Loading a page:** `<p class="loading">Loading…</p>`, and add `role="status"`. **The agent working:** `.working` with `.working-dot`. **Waiting on something outside Oriel:** the `cli-line cli-waiting` line with a `.spinner`, as `Waiting` draws it (`Waiting` in `packages/web/src/cli-row.tsx`).
- **An error beside a control:** `<p class="notice" data-tone="error" role="alert">`, the one error line whose name isn't tied to a page. Inside a connect step, Settings or a change set, use that place's own `*-problem` class.
- **A page that didn't load:** Browse's `div.failed` with a `.button` Try again (`Body` in `packages/web/src/window-page.tsx`), the only load failure with both a retry and an alert.
- **A boxed error at the top of a page:** `.settings-problem`.

The [drift report](/drift) has the proposals.
