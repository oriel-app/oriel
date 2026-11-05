---
title: Undo and notes
status: drifting
group: Feedback
order: 65
classes: undos, undo, undo-action, undo-note, closing-problem, panel-added
summary: The one stack of notes at the foot of the window, each saying what was just done, with its Undo; ⌘Z undoes the newest. Oriel's only toast.
---

# Undo and notes

## What it is

"The one stack of Undo notes at the foot of the window (OA-142): what was done, each with its Undo or why it can't be undone, in the order they showed, newest at the bottom, read out as each shows, and what last failed. None runs out while the pointer or focus is on them, and ⌘Z or Ctrl+Z undoes the one at the bottom" (`packages/web/src/undo-stack.tsx`).

It's one component, `UndoStack`, over one model of time, `undos.ts`. A note (`p.undo`) is a sentence and one action:

- **Undo** (`.undo-action`), which takes back what the sentence says;
- or a **link** in Undo's place, such as Back to the thread an approval moved on from;
- or, when it can't be undone, **why not** (`.undo-note`, faint);
- or nothing, when there's no Undo and no reason to give.

What last failed sits at the foot of the stack as one more note, `role="alert"`, with **Dismiss**.

The stack floats over the page, centred between the sidebar and the item panel, `--space-4` from the bottom (above Browse's picked-items bar when that shows). There's no toast in Oriel other than this, and one line that shares its spot: `.closing-problem`, for a close from a list that failed.

## When to use it

- After an action the person may want back, that Oriel did at once without asking: removing an item from a workstream, making a workstream, marking a workstream done or reopening it, deleting a workstream, adding an item from the panel.
- When an action moved the person somewhere else, to say what happened and offer the way back: "You approved “Pay with a phone wallet on the website”. Applying…" with Back.
- For what failed while doing or undoing one of these, with Dismiss.

## When not to

- Not for something that can't be taken back and loses work. Ask first, with the [confirm dialog](/components/confirm).
- Not for an error that belongs to a control or a form. That goes beside it (see [Empty, loading and error](/components/states)).
- Not for confirming a setting changed. Settings shows the new value; a connection's option says "Set its project." beside it, with its own Undo.
- Not for news the person didn't cause, such as a sync that found new items. That shows where it happened (the sidebar's sources).

## Anatomy and variants

The notes, drawn here as a plain list so they sit in the frame. In the stack each note is only as wide as its words, centred:

```html specimen id=notes title="Every kind of note, oldest first"
<div class="ws-stack">
  <p class="undo">
    <span>Removed SYN-10</span>
    <span class="undo-note">It's no longer in the window, so it can't come back.</span>
  </p>
  <p class="undo">
    <span
      >You approved “Pay with a phone wallet on the website”. Applying…<span
        class="visually-hidden"
      >
        Now on “Weather alerts”, the next thread that needs you.</span
      ></span
    >
    <a
      class="undo-action"
      href="/threads/t-23"
      aria-label="Back to “Pay with a phone wallet on the website”"
      >Back</a
    >
  </p>
  <p class="undo">
    <span>Made the workstream Gift cards, of 4 items.</span>
    <button type="button" class="undo-action" aria-label="Undo making Gift cards">Undo</button>
  </p>
  <p class="undo">
    <span>Removed SYN-8</span>
    <button
      type="button"
      class="undo-action"
      aria-label="Undo removing SYN-8"
      aria-keyshortcuts="Meta+Z"
    >
      Undo
    </button>
  </p>
  <p class="undo" role="alert">
    <span>Oriel can't be reached. Is it still running?</span>
    <button type="button" class="undo-action">Dismiss</button>
  </p>
</div>
```

- **The stack** (`.undos`, `role="status"`): fixed, a centred grid of notes with `--space-2` between them, as wide as its widest note and no wider than the page. It's always in the page, empty or not, so the live region exists before the first note arrives.
- **A note** (`.undo`): `--surface`, `--line` border, `--radius-lg`, `--shadow`, `--text-md`. The sentence, then its action at the end.
- **Undo** (`.undo-action`): accent text, medium weight, an `--accent-soft` fill on hover.
- **Why not** (`.undo-note`): faint, `--text-sm`.

In place, on a narrow page (the stack centres on the page, and a long note wraps):

```html specimen id=in-place title="The stack, fixed at the foot of the page" width=390 height=220
<div class="shell">
  <div class="undos" role="status">
    <p class="undo">
      <span>Deleted “Gift cards”, with its 2 threads.</span>
      <button
        type="button"
        class="undo-action"
        aria-label="Undo: Deleted “Gift cards”, with its 2 threads."
      >
        Undo
      </button>
    </p>
    <p class="undo">
      <span>Added SYN-23 to “Checkout v2: phone wallets and saved cards”.</span>
      <button
        type="button"
        class="undo-action"
        aria-label="Undo: Added SYN-23 to “Checkout v2: phone wallets and saved cards”."
        aria-keyshortcuts="Meta+Z"
      >
        Undo
      </button>
    </p>
  </div>
</div>
```

### A close that failed

When Mark done or Delete… on a thread's row fails after the question has closed, one line says so at the same spot, in `--danger`, until it's dismissed. It isn't part of the stack.

```html specimen id=closing-problem title="A close from a list that failed (.closing-problem)" width=390 height=120
<div class="shell">
  <p class="closing-problem" role="alert">
    Oriel can't be reached. Is it still running?
    <button type="button" class="quiet-action">Dismiss</button>
  </p>
</div>
```

### Undo beside the change

Some Undos sit beside what they undo, with no countdown: under an agent's reply, after a draft is applied, in the item panel after Add to workstream, and beside a connection's option.

```html specimen id=beside title="In the item panel, after Add to workstream (.panel-added)"
<p class="panel-added" role="status">
  <span>Added to “Checkout v2: phone wallets and saved cards”.</span>
  <button
    type="button"
    class="undo-action"
    aria-label="Undo: Added to “Checkout v2: phone wallets and saved cards”."
  >
    Undo
  </button>
</p>
```

## States

```html specimen id=state-hover title="Hover: an accent-soft fill" state=hover
<p class="undo">
  <span>Removed SYN-8</span>
  <button type="button" class="undo-action ws-hover" aria-label="Undo removing SYN-8">Undo</button>
</p>
```

```html specimen id=state-focus title="Focus visible" state=focus-visible
<p class="undo">
  <span>Removed SYN-8</span>
  <button type="button" class="undo-action ws-focus-visible" aria-label="Undo removing SYN-8">
    Undo
  </button>
</p>
```

```html specimen id=state-busy title="Undoing: disabled, but it looks the same" state=busy
<p class="undo">
  <span>Marked “Gift cards” done, with its thread.</span>
  <button
    type="button"
    class="undo-action"
    aria-label="Undo: Marked “Gift cards” done, with its thread."
    disabled
  >
    Undo
  </button>
</p>
```

```html specimen id=state-error title="Error: what last failed, at the foot of the stack" state=error
<p class="undo" role="alert">
  <span>Couldn't undo adding SYN-23: Oriel can't be reached. Is it still running?</span>
  <button type="button" class="undo-action">Dismiss</button>
</p>
```

- **Rest:** a note shows for 8 seconds (`undoMs` in `packages/web/src/undos.ts`).
- **Held:** while the pointer is over the stack or focus is in it, nothing runs out. When both let go, every note still showing gets its full 8 seconds again. Clicking an Undo lets go of the keyboard's hold.
- **Hover:** `.undo-action` gets `--accent-soft` (`.undo-action` in `window.css`). It isn't guarded by `:not(:disabled)`.
- **Focus visible:** the global ring (`:focus-visible` in `window.css`).
- **Busy:** an Undo in flight is disabled. In the stack, a disabled Undo looks exactly like a live one: only `.action-lines .undo-action:disabled` is styled (`.action-lines .undo-action:disabled` in `window.css`).
- **Error:** the problem note, `role="alert"`, with Dismiss. There's one at a time.
- **Empty:** the stack is there with no notes, and takes no room.
- **Active:** not styled.

## Keyboard and ARIA

- ⌘Z on a Mac, Ctrl+Z elsewhere, undoes the newest note that can be undone, from anywhere in the window. Not with Shift or Alt held, and not while typing in a field: "A text field undoes its own typing" (`UndoStack` in `packages/web/src/undo-stack.tsx`).
- That note's Undo carries `aria-keyshortcuts="Meta+Z"` (or `"Control+Z"`), and only that one.
- The stack is `role="status"`, so each new note is read out politely. The problem note is `role="alert"`.
- Every Undo's accessible name is what it undoes: "Undo removing SYN-8", "Undo: Deleted “Gift cards”, with its 2 threads.". The visible word is always "Undo".
- A note may carry words for a screen reader only, in a `.visually-hidden` span, such as where an approval moved the page to.
- On a workstream's page the stack comes after the member list in the page, "so the keyboard reaches them from the last row" (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`).
- The Undo and Redo under an agent's reply have no `aria-label`, so each is only "Undo" or "Redo".

## Content

- Say what was done, in the past tense, naming what it was done to: "Removed SYN-8", "Made the workstream Gift cards, of 4 items.", "Deleted “Gift cards”, with its 2 threads."
- Name a workstream or thread in curly quotes; an item by its key.
- When it can't be undone, say why in one sentence: "It's no longer in the window, so it can't come back."
- The action is one word: **Undo**, **Back**, **Dismiss**.
- A failure says what couldn't be done and why: "Couldn't undo adding SYN-23: {why}".

## Where the app uses it

- `UndoStack` and `UndoButton` in `packages/web/src/undo-stack.tsx`. The time model: `undoMs` and `inShowingOrder` in `packages/web/src/undos.ts`. ⌘Z: `UndoStack` in `packages/web/src/undo-stack.tsx`.
- CSS: `.undos` in `window.css`, raised above the picked-items bar by `.shell:has(.selection-bar) .undos` in `window.css`; `.undo`, `.undo-action` and `.undo-note` in `window.css`.
- Notes: removals `removed` in `packages/web/src/workstream-page.tsx`; made on the overview `OverviewPage` in `packages/web/src/overview-page.tsx`; mark done, reopen and delete `endedText` in `packages/web/src/ending.ts`; the panel's adds `addUndos` in `packages/web/src/panel-adds.ts`; approval `approvedText` in `packages/web/src/approved.ts`.
- `.closing-problem`: `Closing` in `packages/web/src/close-thread.tsx`, CSS `.closing-problem` in `window.css`.
- Undo beside the change: under a reply `ActionLines` in `packages/web/src/thread-page.tsx`, the panel `AddTo` in `packages/web/src/item-panel.tsx`, a connection's option `Said` in `packages/web/src/connections-page.tsx`.

## Drift

Status **drifting**. The stack is one component; what drifts is around it:

- **Dismiss** is an `.undo-action` in the stack's problem note and a `.quiet-action` in `.closing-problem`. The problem note's text is `--text`; the closing line's is `--danger`.
- `.closing-problem` sits where the stack sits, so with both on screen they overlap, and it doesn't move up above Browse's picked-items bar as the stack does.
- A connection's option has its own Undo, drawn as a `.quiet-action`, not an `.undo-action` (`Said` in `packages/web/src/connections-page.tsx`).
- No disabled look on `.undo-action` outside a reply's action lines.
- Note copy: "Removed SYN-8" has no full stop and doesn't quote; the others do. Undo's label is "Undo removing X" for removals and makes, "Undo: {sentence}" for the rest.

**Copy the stack as it is**: give a new note to the page's `UndoStack` through `undos.ts`, as an `UndoNote` with `said`, `label` and `onUndo`; don't draw a second stack or a toast. For an Undo beside its change, use `UndoButton` in `packages/web/src/undo-stack.tsx`. Put a failure in the stack's `problem`, not in a `.closing-problem` of its own.
