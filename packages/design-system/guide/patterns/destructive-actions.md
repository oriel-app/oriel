---
title: Destructive actions and undo
order: 20
summary: Undo for what Oriel can give back; one question, with a danger button, only where Undo can't reach. Remove, mark done, delete a workstream with its threads, disconnect.
---

# Destructive actions and undo

## The problem

A tool someone lives in all day has many small removals: an item out of a workstream, a thread marked done, a workstream finished. Asking "Are you sure?" before each one trains people to click Yes without reading. Not asking before the few that really lose something is worse.

## The pattern

**Do it, and offer Undo.** For anything Oriel can give back, act at once and say what happened in the [undo stack](/components/undo), with **Undo** beside it (decision 0024). ⌘Z (Ctrl+Z) presses the newest Undo when focus isn't in a field.

**Ask once, only where Undo can't reach**, or where what goes is bigger than the click suggests. The question names what goes and what stays, and only its confirm is a danger button.

| Action                            | Asks first?                                                  | After                                               | Undo                                            |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------- |
| Remove an item from a workstream  | No                                                           | "Removed SYN-12"                                    | Yes                                             |
| Mark a workstream done, Reopen    | No                                                           | "Marked “Gift cards” done, with its thread."        | Yes                                             |
| Mark a thread done                | No                                                           | the lists reload                                    | None in the UI (a new message reopens it)       |
| Delete a workstream               | **Yes**, a dialog that counts its threads (decision 0028)    | "Deleted “Gift cards”, with its 3 threads."         | Yes                                             |
| Delete a thread                   | **Yes**, the same dialog, once the server says what it loses | the page gives way                                  | None                                            |
| Disconnect a connection           | **Yes**, inline under its row                                | the row leaves                                      | None: it erases what Oriel read and its sign-in |
| Discard a held message or a draft | No                                                           | "Discarded. The agent never saw it." / "Discarded." | None                                            |
| A change set's write to a source  | it's approved, not confirmed                                 | see [Approval](/patterns/approval)                  | Revert, a change set of its own                 |

### Undo

The note says what happened in the past tense, names the thing, and puts **Undo** beside it. An item the index no longer has can't come back, and the note says so instead.

```html specimen id=undo title="Undo notes: removed, deleted, can't come back"
<div class="ws-stack">
  <p class="undo">
    <span>Removed SYN-12</span
    ><button
      type="button"
      class="undo-action"
      aria-label="Undo removing SYN-12"
      aria-keyshortcuts="Meta+Z"
    >
      Undo
    </button>
  </p>
  <p class="undo">
    <span>Deleted “Gift cards”, with its 3 threads.</span
    ><button
      type="button"
      class="undo-action"
      aria-label="Undo: Deleted “Gift cards”, with its 3 threads."
    >
      Undo
    </button>
  </p>
  <p class="undo">
    <span>Removed SYN-9</span
    ><span class="undo-note">It's no longer in the window, so it can't come back.</span>
  </p>
</div>
```

In the app the notes stand in `<div class="undos" role="status">`, fixed over the foot of the page column, newest at the bottom; each stays 8 seconds, longer while the pointer or focus is on it.

### Remove, at once

A row's × removes at once, with no question. Focus moves to the row below (or above), so the keyboard doesn't lose its place.

```html specimen id=remove title="An item's ×: no question, then Undo"
<ul class="members">
  <li class="member ws-hover">
    <span class="type" data-type="story" title="Story"></span
    ><a
      class="key source-link"
      href="https://synthetic.atlassian.net/browse/SYN-12"
      target="_blank"
      rel="noopener noreferrer"
      >SYN-12</a
    ><span class="member-title">Gift card balance check</span
    ><span class="status" data-category="todo">To Do</span
    ><button type="button" class="remove-member" aria-label="Remove SYN-12">×</button
    ><span role="tooltip" popover="manual" class="tooltip">Remove SYN-12 from this workstream</span>
  </li>
  <li class="member">
    <span class="type" data-type="story" title="Story"></span
    ><a
      class="key source-link"
      href="https://synthetic.atlassian.net/browse/SYN-23"
      target="_blank"
      rel="noopener noreferrer"
      >SYN-23</a
    ><span class="member-title">Pay with a phone wallet on the website</span
    ><span class="status" data-category="in-progress">In Progress</span
    ><button type="button" class="remove-member" aria-label="Remove SYN-23">×</button
    ><span role="tooltip" popover="manual" class="tooltip">Remove SYN-23 from this workstream</span>
  </li>
</ul>
```

### Ask once: Delete

Deleting a workstream that threads use hides them with it (decision 0028), so it asks, and says how many go. The count is sent with the delete and checked: if a thread was added since, the server refuses and the dialog says so. **Cancel has focus**; Escape cancels; only **Delete** is red. It still has an Undo after.

```html specimen id=delete title="The delete question" height=260
<dialog
  class="confirm"
  open
  aria-labelledby="delete-workstream-title"
  aria-describedby="delete-workstream-body"
>
  <form>
    <h2 id="delete-workstream-title" class="confirm-title">Delete “Gift cards”?</h2>
    <p id="delete-workstream-body" class="confirm-body">
      Its 3 threads go with it, out of the sidebar, Needs you, the Done page and search. Its items
      stay in their sources. You can undo this right after.
    </p>
    <div class="confirm-actions">
      <button type="button" class="button ws-focus-visible">Cancel</button>
      <button type="submit" class="button danger">Delete</button>
    </div>
  </form>
</dialog>
```

```html specimen id=delete-refused title="Refused: something changed since it asked" height=280
<dialog
  class="confirm"
  open
  aria-labelledby="delete-again-title"
  aria-describedby="delete-again-body"
>
  <form>
    <h2 id="delete-again-title" class="confirm-title">Delete “Gift cards”?</h2>
    <p id="delete-again-body" class="confirm-body">
      Its 3 threads go with it, out of the sidebar, Needs you, the Done page and search. Its items
      stay in their sources. You can undo this right after.
    </p>
    <p class="confirm-problem" role="alert">It has 4 threads now. Look again before deleting it.</p>
    <div class="confirm-actions">
      <button type="button" class="button">Cancel</button>
      <button type="submit" class="button danger">Delete</button>
    </div>
  </form>
</dialog>
```

A thread's delete uses the same dialog. Its body says "Checking what it changed…" with Delete disabled until the server answers, then what goes: "Its chat and any change sets not applied go for good.", or "It made 2 changes in Jira. After deleting the thread you can no longer revert them from Oriel."

### Ask inline: Disconnect

Disconnecting erases what Oriel read and how it signs in, and there's no Undo. Settings asks under the connection's row, not in a dialog.

```html specimen id=disconnect title="Disconnect, asked inline"
<div class="cli-box" data-tone="warn" role="alertdialog" aria-label="Disconnect Jira · synthetic?">
  <p>
    <strong>Disconnect Jira · synthetic?</strong> Its 214 items leave the window, with what Oriel
    keeps to sign in to it. Workstreams keep them as items Oriel no longer has, and threads keep
    what was said. Nothing changes in Jira.
  </p>
  <div class="cli-actions">
    <button type="button" class="button danger">Disconnect</button>
    <button type="button" class="button">Cancel</button>
  </div>
</div>
```

## Do

- Act at once and offer Undo, for anything Oriel can give back. Say what happened, in the past tense, with the thing's name: "Removed SYN-12", "Marked “Gift cards” done, with its thread."
- Name the Undo for what it undoes: `aria-label="Undo removing SYN-12"`.
- Ask only where Undo can't reach, or where more goes than the click shows. Say what goes and what stays: "Its items stay in their sources."
- Put the danger fill only on the confirm, never on the first click. The first click is a menu item or button labelled **Delete…**, with the ellipsis because it asks.
- Give the question's focus to Cancel, so Enter on a reflex doesn't delete.
- Check the count you showed: send it, and refuse if it's changed.
- Keep a busy label on the confirm while it works: **Deleting…**, **Disconnecting…**.

## Don't

- Don't confirm what Undo can take back. Removing an item, marking done: no question.
- Don't show a red button before the question. Delete in a menu is `data-danger` text; only the confirm is filled.
- Don't say "Are you sure?". Say what will happen.
- Don't let ⌘Z undo inside a text field; the field undoes its own typing.
- Don't confirm a change set's write. It's approved, from its diff.

## Where Oriel does it

- The undo stack, ⌘Z included: `UndoStack` in `packages/web/src/undo-stack.tsx`. CSS `.undos`, `.undo`, `.undo-action` and `.undo-note` in `window.css`.
- Remove an item: the ×, drawn by `Member` in `packages/web/src/parts.tsx`; its note, `removed` in `packages/web/src/workstream-page.tsx`.
- Mark done, Reopen, Delete a workstream: the head's buttons, `EndButtons` in `packages/web/src/end-workstream.tsx`; the menu, `endings` in `packages/web/src/end-workstream.tsx`; the words, `endedText` and `deleteWarning` in `packages/web/src/ending.ts`. The page after: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`, "Deleted. Nothing lists it or its threads now, and its items stay in their sources."
- The question: `Confirm` in `packages/web/src/close-thread.tsx`, a native `<dialog>` opened with `showModal()`. CSS `.confirm` in `window.css`. A thread's menu: `ThreadMenu` in `packages/web/src/close-thread.tsx`.
- Disconnect: `Disconnect` in `packages/web/src/connections-page.tsx`.
- Menus and swipes, which is how the keyboard and a trackpad reach a row's Delete…: see [Menu](/components/menu).

### Drift

- **Two shapes of question.** Delete is a modal dialog with Cancel first and focused; Disconnect is an inline `role="alertdialog"` with Disconnect first, and nothing moves focus into it (`Disconnect` in `packages/web/src/connections-page.tsx`). Until they're one, copy the modal `Confirm` for a new question.
- **Mark a thread done has no Undo**, though decision 0024 says it undoes as reopening.
- **Two failure toasts.** A failed delete from a list shows `.closing-problem` in `window.css`; a workstream's shows in the undo stack.
- See [Confirm](/components/confirm) and [Undo](/components/undo) for the components themselves.
