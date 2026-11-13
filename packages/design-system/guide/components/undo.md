---
title: Undo
status: drifting
group: Feedback
order: 65
classes: undo-action, panel-added
summary: The one word that takes back what was just done. In the bead for the window's notes, and beside the change for a reply's actions, an applied draft and the panel's add; ⌘Z undoes the newest note.
---

# Undo

## What it is

Undo takes back what Oriel just did without asking (decision 0024). It's one component, `UndoButton` in `packages/web/src/undo-stack.tsx`: "A note's Undo, in the bead or beside the change it undoes". It shows in two places:

- **In the bead**, the window's one stack of notes at the top of the page column, as `.bead-action`, with its key. That's where a removal, a made, ended or deleted workstream, a panel's add and an approval say what happened. See [The bead](/components/bead).
- **Beside the change**, as `.undo-action`, with no countdown: under an agent's reply, after a draft is applied, in the item panel after Add to workstream, and beside a connection's option.

One model of time, `undos.ts`, runs every note in the bead. An Undo beside its change stays as long as what it undoes does.

## When to use it

- After an action the person may want back, that Oriel did at once without asking. Give its note to the page's bead through `undos.ts`; don't draw a stack of your own.
- Beside the change, when what it undoes stays on screen to be read: a reply's action line ("Added SYN-23 to Checkout v2"), a draft "Applied. Jira reads this way now.", the panel's "Added to “Checkout v2: phone wallets and saved cards”."

## When not to

- Not for something that can't be taken back and loses work. Ask first, with the [confirm dialog](/components/confirm).
- Not as a second note for a change the bead already says. The panel's add is said beside the item and noted in the bead, and the page shows the bead's note only once (`Endings` in `packages/web/src/end-workstream.tsx`).
- Not for a field's own typing: a text field undoes that itself, and ⌘Z leaves it alone.

## Anatomy and variants

Beside the change, the Undo is an accent word at the end of the line that says what was done:

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

```html specimen id=reply title="Under a reply: Undo, and Redo once undone"
<ul class="action-lines">
  <li>
    <span class="action-text">Added SYN-23 to Checkout v2</span>
    <button type="button" class="undo-action">Undo</button>
  </li>
  <li data-undone="yes">
    <span class="action-text">Added SYN-24 to Checkout v2</span>
    <button type="button" class="undo-action">Redo</button>
  </li>
</ul>
```

- **Undo** (`.undo-action`): accent text, medium weight, `--text-md`, `--radius-sm`, an `--accent-soft` fill on hover. Under a reply it's `--text-sm` (`.action-lines .undo-action` in `window.css`).
- **The line it ends** says what was done: `.panel-added` in the panel, `--text-sm`, muted; a reply's `.action-lines`; a draft's `.held-note`.

In the bead the same `UndoButton` takes the class `.bead-action` and, on the note ⌘Z undoes, shows the key:

```html specimen id=in-bead title="The same Undo, in the bead" height=96
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="1"
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-in-bead"
          filterUnits="userSpaceOnUse"
          x="-100"
          y="-100"
          width="10000"
          height="2000"
        >
          <feDropShadow dx="0" dy="1" stdDeviation="2.2" />
        </filter>
      </defs>
      <path
        filter="url(#cast-in-bead)"
        d="M157.5,-2V0C164.68,0 170.5,5.82 170.5,13V28C170.5,36.84 177.66,44 186.5,44H373.5C382.34,44 389.5,36.84 389.5,28V13C389.5,5.82 395.32,0 402.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 171px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span
          ><button
            type="button"
            class="bead-action"
            aria-label="Undo removing SYN-23"
            aria-keyshortcuts="Meta+Z"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

## States

```html specimen id=state-hover title="Hover: an accent-soft fill" state=hover
<p class="panel-added">
  <span>Added to “Checkout v2: phone wallets and saved cards”.</span>
  <button type="button" class="undo-action ws-hover" aria-label="Undo: Added to “Checkout v2”.">
    Undo
  </button>
</p>
```

```html specimen id=state-focus title="Focus visible" state=focus-visible
<p class="panel-added">
  <span>Added to “Checkout v2: phone wallets and saved cards”.</span>
  <button
    type="button"
    class="undo-action ws-focus-visible"
    aria-label="Undo: Added to “Checkout v2”."
  >
    Undo
  </button>
</p>
```

```html specimen id=state-busy title="Undoing: disabled; faint only under a reply" state=busy
<div class="ws-stack">
  <p class="panel-added">
    <span>Added to “Checkout v2: phone wallets and saved cards”.</span>
    <button type="button" class="undo-action" aria-label="Undo: Added to “Checkout v2”." disabled>
      Undo
    </button>
  </p>
  <ul class="action-lines">
    <li>
      <span class="action-text">Added SYN-23 to Checkout v2</span>
      <button type="button" class="undo-action" disabled>Undo</button>
    </li>
  </ul>
</div>
```

- **Hover:** `.undo-action` gets `--accent-soft` (`.undo-action:hover` in `window.css`). It isn't guarded by `:not(:disabled)`.
- **Focus visible:** the global ring (`:focus-visible` in `window.css`).
- **Busy:** an Undo in flight is disabled. Beside the change, a disabled Undo looks exactly like a live one, except under a reply: only `.action-lines .undo-action:disabled` in `window.css` is styled. In the bead it's faint.
- **Undone:** under a reply the line goes muted and its Undo becomes **Redo** (`li[data-undone="yes"]`).
- **Error:** a failed Undo says so in the bead ("Couldn't undo adding SYN-23: {why}"), and beside the change in the panel's `.panel-problem`.
- **Active:** not styled.

## Keyboard and ARIA

- ⌘Z on a Mac, Ctrl+Z elsewhere, undoes the bead's newest note that can be undone, from anywhere in the window. Not with Shift or Alt held, and not while typing in a field (`UndoStack` in `packages/web/src/undo-stack.tsx`). That Undo carries `aria-keyshortcuts="Meta+Z"` (or `"Control+Z"`), and only that one. An Undo beside its change has no key.
- F8 takes the keyboard to the bead's newest action, and Escape back (see [The bead](/components/bead#keyboard-and-aria)).
- `UndoButton`'s accessible name is what it undoes: "Undo removing SYN-8", "Undo: Added to “Checkout v2: phone wallets and saved cards”.". The visible word is always "Undo".
- The Undo and Redo under an agent's reply, and a draft's Undo, have no `aria-label`, so each is only "Undo" or "Redo".
- The panel's line is `role="status"`, so the add and its Undo are read as they show.

## Content

- The word is **Undo**, or **Redo** once undone under a reply. Nothing else: not "Revert", not "Take back".
- The line before it says what was done, in the past tense, naming what it was done to: "Added to “Checkout v2: phone wallets and saved cards”.", "Applied. Jira reads this way now."
- Its label is "Undo: {what was done}", or "Undo removing {key}" for a removal.

## Where the app uses it

- `UndoButton` in `packages/web/src/undo-stack.tsx`; in the bead, `UndoStack` in `packages/web/src/undo-stack.tsx`, which passes it `.bead-action`.
- CSS: `.undo-action` and `.undo-action:hover` in `window.css`; under a reply, `.action-lines .undo-action` and `.action-lines .undo-action:disabled` in `window.css`; the panel's line, `.panel-added` in `window.css`.
- Beside the change: under a reply `ActionLines` in `packages/web/src/thread-page.tsx`; an applied draft `DraftCard` in `packages/web/src/thread-page.tsx`; the panel `AddTo` in `packages/web/src/item-panel.tsx`; a connection's option `Said` in `packages/web/src/connections-page.tsx`.
- The time model for the bead's notes: `undoMs` and `inShowingOrder` in `packages/web/src/undos.ts`.

## Drift

Status **drifting**. The bead fixed the stack's own drift: a disabled Undo in the bead is faint, its hover is guarded, a close from a list that failed is a failure in the bead with the same Dismiss rather than a box of its own, and nothing overlaps it. What still drifts is beside the change:

- A connection's option has its own Undo, drawn as a `.quiet-action`, not an `.undo-action` or `UndoButton` (`Said` in `packages/web/src/connections-page.tsx`).
- No disabled look on `.undo-action` outside a reply's action lines, and its hover isn't guarded.
- A reply's and a draft's Undo are hand-written buttons with no label, not `UndoButton`.
- Note copy: "Removed SYN-8" has no full stop and doesn't quote; the others do. Undo's label is "Undo removing X" for removals, "Undo: {sentence}" for the rest.

**Copy `UndoButton`**: for a note, give it to the page's bead through `undos.ts`, as an `UndoNote` with `said`, `label` and `onUndo`; beside its change, render `UndoButton` with its `label`. Put a failure in the bead's `problem`, not a box of its own.
