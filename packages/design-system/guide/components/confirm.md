---
title: Confirm dialog
status: drifting
group: Feedback
order: 60
classes: confirm, confirm-title, confirm-body, confirm-problem, confirm-actions
summary: The one question a delete asks first, a modal the keyboard can answer, saying what deleting would lose. Disconnect asks the same kind of question inline.
---

# Confirm dialog

## What it is

"The one question a delete asks first, as a modal the keyboard can answer: Cancel has focus, Enter deletes, and Escape cancels, closing nothing behind it, such as the drawer" (`Confirm` in `packages/web/src/close-thread.tsx`). It's one component, `Confirm`: a `<dialog class="confirm">` opened with `showModal()`, so it sits in the top layer over a `--scrim` backdrop, and the page behind it is inert until it closes.

It has a title that asks ("Delete “Pay with a phone wallet”?"), a body that says what would be lost, at most one problem line, and two buttons: **Cancel** (`.button`, with focus) and **Delete** (`.button.danger`, the form's submit).

Two things use it: deleting a thread from a list (its context menu or swipe), and deleting a workstream (its menu, or the trash button in its page's header). Oriel has no other modal. See [Destructive actions](/patterns/destructive-actions) for when a delete asks and when it offers Undo instead.

## When to use it

- Before something that can't be taken back with Undo, and that loses something the person would miss: a thread's chat and the change sets not applied.
- Where the person needs to read what would go before deciding. The body is the point of the dialog; the title only asks.
- Workstream deletes ask too, even though they can be undone right after, because they take threads with them. The body says "You can undo this right after."

## When not to

- Not for something Undo can take back cheaply, such as removing an item from a workstream or marking a thread done. Do it, and put a note with Undo in the [undo stack](/components/undo).
- Not for a question that isn't destructive ("Are you sure you want to send?"). Just do it.
- Not as a general modal for forms or details. Oriel has no other dialog; details open in the [item panel](/components/item-panel).
- Not with a second question after the first. One question per delete.

## Anatomy and variants

The app opens it with `showModal()`, centred over a `--scrim` backdrop. A specimen can't do that without a script, so these draw it with `open`, in place, without the backdrop or the modal's focus trap, and without Cancel's `autofocus`, which would pull focus into the frame. Add `autofocus` to Cancel when you copy it.

```html specimen id=checking title="Asked: checking what the thread changed, so Delete waits" height=160
<dialog class="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body" open>
  <form>
    <h2 id="confirm-title" class="confirm-title">
      Delete “Pay with a phone wallet on the website”?
    </h2>
    <p id="confirm-body" class="confirm-body">Checking what it changed…</p>
    <div class="confirm-actions">
      <button type="button" class="button">Cancel</button>
      <button type="submit" class="button danger" disabled>Delete</button>
    </div>
  </form>
</dialog>
```

```html specimen id=ready title="Ready: the body says what deleting would lose" height=180
<dialog class="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body" open>
  <form>
    <h2 id="confirm-title" class="confirm-title">
      Delete “Pay with a phone wallet on the website”?
    </h2>
    <p id="confirm-body" class="confirm-body">
      It made 2 changes in Jira. After deleting the thread you can no longer revert them from Oriel.
    </p>
    <div class="confirm-actions">
      <button type="button" class="button">Cancel</button>
      <button type="submit" class="button danger">Delete</button>
    </div>
  </form>
</dialog>
```

```html specimen id=workstream title="A workstream: ready at once, and undoable right after" height=200
<dialog
  class="confirm"
  aria-labelledby="delete-workstream-title"
  aria-describedby="delete-workstream-body"
  open
>
  <form>
    <h2 id="delete-workstream-title" class="confirm-title">Delete “Gift cards”?</h2>
    <p id="delete-workstream-body" class="confirm-body">
      Its 2 threads go with it, out of the sidebar, Needs you, the Done page and search. Its items
      stay in their sources. You can undo this right after.
    </p>
    <div class="confirm-actions">
      <button type="button" class="button">Cancel</button>
      <button type="submit" class="button danger">Delete</button>
    </div>
  </form>
</dialog>
```

### Disconnect asks inline

Disconnecting a connection asks a question of the same kind, but not in the dialog: a `.cli-box[data-tone="warn"]` with `role="alertdialog"` opens in the connection's row, in place of its Disconnect button.

```html specimen id=disconnect title="Disconnect, asked in the row (Settings › Connections)"
<div class="cli-box" data-tone="warn" role="alertdialog" aria-label="Disconnect Jira?">
  <p>
    <strong>Disconnect Jira?</strong> Its 28 items leave the window, with what Oriel keeps to sign
    in to it. Workstreams keep them as items Oriel no longer has, and threads keep what was said.
    Nothing changes in Jira.
  </p>
  <div class="cli-actions">
    <button type="button" class="button danger">Disconnect</button>
    <button type="button" class="button">Cancel</button>
  </div>
</div>
```

## States

```html specimen id=state-focus title="Opened from the keyboard: Cancel has focus" state=focus-visible height=180
<dialog class="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body" open>
  <form>
    <h2 id="confirm-title" class="confirm-title">Delete “Gift cards”?</h2>
    <p id="confirm-body" class="confirm-body">
      It has no threads. Its items stay in their sources.
    </p>
    <div class="confirm-actions">
      <button type="button" class="button ws-focus-visible">Cancel</button>
      <button type="submit" class="button danger">Delete</button>
    </div>
  </form>
</dialog>
```

```html specimen id=state-busy title="Deleting: Delete is disabled and says so" state=busy height=180
<dialog class="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body" open>
  <form>
    <h2 id="confirm-title" class="confirm-title">
      Delete “Pay with a phone wallet on the website”?
    </h2>
    <p id="confirm-body" class="confirm-body">
      Its chat and any change sets not applied go for good.
    </p>
    <div class="confirm-actions">
      <button type="button" class="button">Cancel</button>
      <button type="submit" class="button danger" disabled>Deleting…</button>
    </div>
  </form>
</dialog>
```

```html specimen id=state-error title="Error: one line, above the buttons, and the question stays" state=error height=200
<dialog class="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body" open>
  <form>
    <h2 id="confirm-title" class="confirm-title">
      Delete “Pay with a phone wallet on the website”?
    </h2>
    <p id="confirm-body" class="confirm-body">
      Its chat and any change sets not applied go for good.
    </p>
    <p class="confirm-problem" role="alert">Oriel can't be reached. Is it still running?</p>
    <div class="confirm-actions">
      <button type="button" class="button">Cancel</button>
      <button type="submit" class="button danger">Delete</button>
    </div>
  </form>
</dialog>
```

- **Asked, not ready:** a thread's dialog opens at once with "Checking what it changed…" and Delete disabled, until the server says what the thread changed. A workstream's is ready at once.
- **Ready:** Delete is live. Enter deletes, since Delete is the form's submit.
- **Focus:** Cancel has focus when the dialog opens (`autofocus`), so a stray Enter on opening doesn't delete. Then the buttons show the global ring.
- **Busy:** Delete is disabled and reads "Deleting…". Cancel stays live.
- **Error:** `.confirm-problem` in `--danger`, `role="alert"`, above the buttons. The dialog stays open, so the person can try again or cancel. A failure after the dialog has closed shows as `.closing-problem` instead (see [Undo and notes](/components/undo)).
- **Hover:** the buttons' own. **Active, empty:** don't apply.
- **Closing:** a thread's dialog closes once the delete is done. A thread delete leaves no Undo (decision 0024); a workstream delete leaves "Deleted “Gift cards”, with its 2 threads." with Undo in the stack.

## Keyboard and ARIA

- A native `<dialog>` opened with `showModal()`: focus moves inside, Tab stays inside, and the rest of the window is inert.
- `aria-labelledby` points at the title and `aria-describedby` at the body, so a screen reader reads the question and what would be lost as the dialog opens. Each use has its own ids (`confirm-title`, `delete-workstream-title`).
- Cancel carries `autofocus`. Enter on Cancel cancels; Enter elsewhere in the form submits it, which deletes.
- Escape cancels. The dialog's `keydown` stops Escape there, so it closes nothing behind it, such as the drawer, and its `cancel` event is prevented so the model, not the browser, closes it (`Confirm` in `packages/web/src/close-thread.tsx`).
- The open dialog's contents are only rendered while it's asked, so a closed dialog holds nothing a screen reader could find.
- **Disconnect's inline question** is `role="alertdialog"` with an `aria-label`, but it doesn't move focus, doesn't answer Escape, and puts Disconnect first.

## Content

- The title asks, naming the thing in curly quotes: "Delete “Gift cards”?" A thread with no title is "New thread".
- The body says what goes and what stays, in plain sentences, in the person's terms: "Its chat and any change sets not applied go for good." "Its items stay in their sources."
- Say what Oriel can no longer do after: "After deleting the thread you can no longer revert them from Oriel."
- Say when it can be undone: "You can undo this right after."
- The buttons are **Cancel** and the verb: **Delete**, **Disconnect**. Never "OK" or "Yes". The menu item that opens it ends in "…": **Delete…**.
- While waiting: "Checking what it changed…". While deleting: "Deleting…".

## Where the app uses it

- `Confirm` in `packages/web/src/close-thread.tsx`, opened in a layout effect. CSS `.confirm`, `.confirm::backdrop`, `.confirm-title`, `.confirm-body`, `.confirm-problem`, `.confirm-actions` and `.button.danger` in `window.css`.
- A thread's delete: `Closing` in `packages/web/src/close-thread.tsx`, its body from `deletionWarning` in `packages/web/src/closing.ts`.
- A workstream's delete: `Endings` in `packages/web/src/end-workstream.tsx`, its body from `deleteWarning` in `packages/web/src/ending.ts`. The header's trash button: `EndButtons` in `packages/web/src/end-workstream.tsx`.
- Disconnect, asked inline: `Disconnect` in `packages/web/src/connections-page.tsx`. CSS `.cli-box[data-tone="warn"]` in `window.css`.

## Drift

Status **drifting**: two shapes of one question.

|              | Delete (thread, workstream)    | Disconnect                      |
| ------------ | ------------------------------ | ------------------------------- |
| Shape        | modal `<dialog>`, scrim        | inline `.cli-box`, in the row   |
| Role         | dialog, labelled and described | `alertdialog`, labelled         |
| Focus        | moves to Cancel                | stays on the button that asked  |
| Escape       | cancels                        | does nothing                    |
| Button order | Cancel, then Delete            | Disconnect, then Cancel         |
| Busy         | "Deleting…"                    | "Disconnecting…", both disabled |

**Copy `Confirm`** (`Confirm` in `packages/web/src/close-thread.tsx`; it's exported, so import it) for any new question before something destructive. Don't copy the inline Disconnect box for a question. The [Destructive actions](/patterns/destructive-actions) pattern says when to ask and when to offer Undo instead.
