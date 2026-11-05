---
title: The bead
status: stable
group: Feedback
order: 64
classes: bead-wrap, bead, bead-under, bead-layer, bead-row, bead-said, bead-action, bead-cannot, bead-count, bead-mark, bead-dot, bead-frame, bead-panes, bead-pane, bead-glint, bead-time
summary: Oriel's one toast. An ink pill at the top centre of the page column, on the window's top line, saying what was just done, with its Undo; F8 reaches it, ⌘Z undoes the newest.
---

# The bead

## What it is

The bead (decision 0056) is where the window's one stack of Undo notes shows: "an ink pill at the top centre of the page column, on the window's top line. It grows from a dot to say the newest note, with a count and edges beneath it while there are more, and shrinks back to the dot as the last one goes" (`UndoStack` in `packages/web/src/undo-stack.tsx`). "Bead" names the place; what it says is still a note.

A note (`UndoNote` in `packages/web/src/undos.ts`) is a sentence and one action:

- **Undo**, which takes back what the sentence says, with its key (⌘Z or Ctrl+Z) beside it;
- or a **link** in Undo's place, such as Back to the thread an approval moved on from;
- or, when it can't be undone, **why not** (`.bead-cannot`, faint);
- or nothing.

An approval's note carries a **mark**: Applying, with a breathing dot; Applied, with a check that draws itself; or All caught up, with Oriel's own mark. A failure is one more thing the bead says, with a danger mark and **Dismiss**, until it's dismissed.

It's Oriel's only toast. A note that keeps its key changes in place: Applying becomes Applied, and a failed apply its problem, in the one shape.

## When to use it

- After an action the person may want back, that Oriel did at once without asking: removing an item from a workstream, making a workstream, marking a workstream done or reopening it, deleting a workstream, adding an item from the panel.
- When an action moved the person somewhere else, to say what happened and offer the way back: "You approved “Pay with a phone wallet on the website”. Applying…", with Back.
- For what failed while doing or undoing one of these, or a close from a list that failed, with Dismiss.

## When not to

- Not for something that can't be taken back and loses work. Ask first, with the [confirm dialog](/components/confirm).
- Not for an error that belongs to a control or a form. That goes beside it (see [Empty, loading and error](/components/states)).
- Not for confirming a setting changed. Settings shows the new value, and a connection's option says "Set its project." beside it, with its own Undo (see [Undo](/components/undo)).
- Not for news the person didn't cause, such as a sync that found new items. That shows where it happened (the sidebar's sources).
- Not a second stack or toast of a page's own. Give the note to the page's bead.

## Anatomy and variants

Drawn here in a frame of its own, centred on it. In the window it centres on the page column, clear of the sidebar, and of the item panel or window chat where either lies over the page. The bead sizes itself to its words: `UndoStack` measures them at their final width and sets `--w` and `--h` on `.bead-wrap`, so the specimens set them as it would.

```html specimen id=note title="A note, with its Undo and key" height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="1"
    style="--w: 205px; --h: 36px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span>
          <button
            type="button"
            class="bead-action"
            aria-label="Undo removing SYN-23"
            aria-keyshortcuts="Meta+Z"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

- **The wrap** (`.bead-wrap`, `role="region"`, "Notes"): fixed, `--inset-top` from the top, at the centre of what's left of the page column. It has no size of its own; the bead hangs from it. `data-tone` is the face's tone (`note`, `applying`, `applied`, `caught-up` or `problem`), `data-count` how many it holds, up to 3.
- **The bead** (`.bead`): `--bead` ink, `--bead-radius`, `--shadow`, and in the dark a `--line-strong` hairline (`--bead-ring`). A dot (`--bead-dot`) at rest, `--w` by `--h` with a note, centred on the top line (`--head-row`); taller faces hang from it.
- **A face** (`.bead-layer`): what it says, laid out at its own width (`max-content`, up to `--bead-max`, 28rem) and centred, so as the bead's edges move its words don't. `--text-md`, a little more open than `--leading-tight` (1.35), so one line is 36px tall.
- **A row** (`.bead-row`): the mark, the sentence (`.bead-said`) and the action.
- **The action** (`.bead-action`): Undo, Back or Dismiss, in `--bead-accent`, medium weight, rounded as the bead is (`--bead-radius`), with its key in a `kbd`, faint, hidden on touch.
- **Why not** (`.bead-cannot`): faint, `--text-sm`, in the action's place.
- **Time left** (`.bead-time`): a hairline at its foot that drains over the note's 8 seconds (`--bead-life`), and stops while the bead is held. A failure has none.

Every colour on the ink is the bead's own, derived on `html` from the theme: `--bead-text`, `--bead-faint`, `--bead-accent`, `--bead-working`, `--bead-done` and `--bead-danger`, each 4.5:1 or more on `--bead` in every theme and scheme (Oriel's theme check holds them to it). See [Colour](/foundations/colour).

```html specimen id=cannot title="A note that can't be undone, says why" height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="1"
    style="--w: 427px; --h: 32px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-10</span>
          <span class="bead-cannot">It's no longer in the window, so it can't come back.</span>
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

### An approval

With After you approve set to go on, approving moves the page to the next thread that needs the person, and the bead says what happened, with Back. The mark comes from the approval's own answer, never from the words (`approvedText` in `packages/web/src/approved.ts`).

```html specimen id=applying title="Applying: a breathing dot, and Back" height=120
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="applying"
    data-count="1"
    style="--w: 449px; --h: 45px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-mark" data-mark="applying"><span class="bead-dot"></span></span>
          <span class="bead-said"
            >You approved “Pay with a phone wallet on the website”. Applying…<span
              class="visually-hidden"
            >
              Now on “Weather alerts”, the next thread that needs you.</span
            ></span
          >
          <a
            class="bead-action"
            href="/threads/t-23"
            aria-label="Back to “Pay with a phone wallet on the website”"
            >Back</a
          >
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

```html specimen id=applied title="Applied: a check that draws itself" height=120
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="applied"
    data-count="1"
    style="--w: 394px; --h: 36px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <svg class="bead-mark" data-mark="applied" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" />
            <path d="M5 8.3l2.1 2.1L11 6.2" pathLength="1" />
          </svg>
          <span class="bead-said">Applied “Pay with a phone wallet on the website”.</span>
          <a
            class="bead-action"
            href="/threads/t-23"
            aria-label="Back to “Pay with a phone wallet on the website”"
            >Back</a
          >
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

When nothing else needs the person, the page stays, and the bead plays its one flourish: Oriel's mark draws (`.bead-frame`), its three panes (`.bead-panes`, `.bead-pane`) light one by one, and one glint (`.bead-glint`) crosses the pill, in about 1.6 s. It plays once.

```html specimen id=caught-up title="All caught up" height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="caught-up"
    data-count="1"
    style="--w: 136px; --h: 32px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row" data-bare>
          <svg class="bead-mark" data-mark="caught-up" viewBox="0 0 20 20" aria-hidden="true">
            <g class="bead-panes">
              <rect class="bead-pane" x="2.5" y="2.5" width="15" height="6" />
              <rect class="bead-pane" x="2.5" y="8.5" width="7.5" height="9" />
              <rect class="bead-pane" x="10" y="8.5" width="7.5" height="9" />
            </g>
            <rect
              class="bead-frame"
              x="2.5"
              y="2.5"
              width="15"
              height="15"
              rx="3.5"
              pathLength="1"
            />
            <path class="bead-frame" d="M2.5 8.5h15M10 8.5v9" pathLength="1" />
          </svg>
          <span class="bead-said">All caught up.</span>
        </div>
        <span class="bead-glint"></span>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

### Several notes

With more than one, the bead shows the newest, with a count (`.bead-count`) that pops as each arrives, and one or two edges underneath (`.bead-under`, `data-depth` 1 and 2).

```html specimen id=several title="Three notes: the newest, a count and two edges" height=110
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="3"
    style="--w: 238px; --h: 36px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <span class="bead-count" aria-hidden="true">3</span>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-104</span>
          <button
            type="button"
            class="bead-action"
            aria-label="Undo removing SYN-104"
            aria-keyshortcuts="Meta+Z"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

Pointer or focus on it opens them as a list, newest first, nearest the top line, each with its own Undo. Only the newest carries the key. Held open, it may hang over the page: that is the person's doing.

```html specimen id=held title="Held open: a list, newest first" height=150
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="3"
    data-open
    data-held
    style="--w: 214px; --h: 92px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1" data-list>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-104</span>
          <button
            type="button"
            class="bead-action"
            aria-label="Undo removing SYN-104"
            aria-keyshortcuts="Meta+Z"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-99</span>
          <button type="button" class="bead-action" aria-label="Undo removing SYN-99">Undo</button>
        </div>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span>
          <button type="button" class="bead-action" aria-label="Undo removing SYN-23">Undo</button>
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

### A failure

What failed: a danger mark, the problem and Dismiss, with no spring and no time left. It stays until dismissed, wherever the page goes. It takes its place among the notes by when it showed. A close from a list that failed is one of these (`closingProblem` in `packages/web/src/close-thread.tsx`), not a box of its own.

```html specimen id=problem title="A close from a list that failed" height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="problem"
    data-count="1"
    style="--w: 381px; --h: 36px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <svg class="bead-mark" data-mark="problem" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.6" />
            <path d="M8 4.8v3.8M8 11v.2" />
          </svg>
          <span class="bead-said">The thread changed since this page loaded.</span>
          <button type="button" class="bead-action">Dismiss</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

### On a phone

In the narrow bar it sits centred in the bar, clear of the menu and its count, over the brand, and wraps to `100vw - 7.5rem`.

```html specimen id=narrow title="In the narrow bar" width=390 height=110
<div class="shell">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="1"
    style="--w: 271px; --h: 45px"
  >
    <div class="bead-under" data-depth="2"></div>
    <div class="bead-under" data-depth="1"></div>
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Marked “Gift cards” done, with its thread.</span>
          <button
            type="button"
            class="bead-action"
            aria-label="Undo: Marked “Gift cards” done, with its thread."
            aria-keyshortcuts="Meta+Z"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
      <div class="bead-time" style="--bead-life: 8000ms"></div>
    </div>
  </div>
</div>
```

### Making room

The bead may cover the crumb's row, a page title on the top line, and on a phone the brand, for the note's life. Where it would cover a control on the page's own top lines (the overview's counts, Browse's tabs, a workstream's name), the page moves down under it until the note goes: `makeRoom` in `packages/web/src/undo-stack.tsx` sets `--bead-room` and `data-bead-room` on the shell, and `.shell[data-bead-room] .shell-main` in `window.css` adds that much `padding-top`. Head-row and layout work must allow for it. Held open as a list, it makes no room.

## States

```html specimen id=state-hover title="Hover: a fill mixed from the bead's accent" state=hover height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    data-tone="note"
    data-count="1"
    data-held
    style="--w: 205px; --h: 36px"
  >
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span>
          <button type="button" class="bead-action ws-hover" aria-label="Undo removing SYN-23">
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

```html specimen id=state-focus title="Focus visible: an inset ring in the bead's accent" state=focus-visible height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    data-tone="note"
    data-count="1"
    data-held
    style="--w: 205px; --h: 36px"
  >
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span>
          <button
            type="button"
            class="bead-action ws-focus-visible"
            aria-label="Undo removing SYN-23"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

```html specimen id=state-busy title="Undoing: disabled, faint" state=busy height=96
<div class="shell" style="--sidebar: 0rem">
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    data-tone="note"
    data-count="1"
    data-held
    style="--w: 348px; --h: 36px"
  >
    <div class="bead">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Marked “Gift cards” done, with its thread.</span>
          <button
            type="button"
            class="bead-action"
            aria-label="Undo: Marked “Gift cards” done, with its thread."
            disabled
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

- **Rest:** a dot, not drawn while there's nothing to say: the bead is only in the page while it has a note.
- **Arriving:** it shows as the dot for a moment, then grows on a spring (`--duration-morph`, `--ease-spring`), and its words come in with a 2px blur, growing a little, once its shape has nearly settled. `data-arriving` is on the wrap until it has grown (`UndoStack` in `packages/web/src/undo-stack.tsx`).
- **Changing:** a new face's words come in as the last one's go, faster than they came; a note that keeps its key changes in place.
- **Held:** while the pointer is on it or focus is in it, nothing runs out and its hairline stops (`data-held`). When both let go, every note still showing gets its full 8 seconds again (`undoMs` in `packages/web/src/undos.ts`). Clicking an Undo lets go of the keyboard's hold.
- **Open:** held with more than one note, it opens as the list (`data-open`); the edges and the hairline hide.
- **Leaving:** its words go first, then it shrinks back to the dot and fades (`data-leaving`), and takes no pointer.
- **Hover:** a fill of `--bead-accent` mixed 18% into the ink, guarded by `:not(:disabled)` (`.bead-action:hover:not(:disabled)` in `window.css`).
- **Focus visible:** an inset ring in `--bead-accent`, not the global ring, which wouldn't show on the ink (`.bead-action:focus-visible` in `window.css`).
- **Busy:** an Undo in flight is disabled, in `--bead-faint`.
- **Error:** the failure face, settling with `--ease-out`, not the spring: good news may bounce, bad news doesn't.
- **Reduced motion:** only fades remain. It arrives at its size and fades in, swaps its words at once, shows its marks drawn and the panes lit, and fades out where it is. No spring, no glint, no hairline, and the page's move to make room is instant.
- **Active:** not styled.

## Keyboard and ARIA

- **F8 shows the notes,** from anywhere, a text field included: it focuses the newest note's action, or the face itself when it has none, and focus holds the bead open. Escape goes back to where focus was, and closes nothing behind the bead (`UndoStack` in `packages/web/src/undo-stack.tsx`). The wrap carries `aria-keyshortcuts="F8"`. F8 is the window's: don't bind it elsewhere.
- ⌘Z on a Mac, Ctrl+Z elsewhere, undoes the newest note that can be undone, from anywhere in the window, but not with Shift or Alt held, and not while typing in a field: "A text field undoes its own typing". That note's Undo carries `aria-keyshortcuts="Meta+Z"` (or `"Control+Z"`) and shows the key, and only that one.
- The bead is a `role="region"` named "Notes", in the tab order only through its actions.
- **One status region,** always there on every page but a review link's: `BeadStatus` in `packages/web/src/undo-stack.tsx`, a visually hidden `role="status"` and `role="alert"`. Each note is read once as it shows, and again only if what it says changes, as Applying to Applied. Its `heard` text, such as "Now on “Weather alerts”, the next thread that needs you.", is read with it. A failure is read through the alert.
- Every Undo's accessible name is what it undoes: "Undo removing SYN-8", "Undo: Deleted “Gift cards”, with its 2 threads.". The visible word is always "Undo". A link's is where it goes: "Back to “Pay with a phone wallet on the website”".
- The marks, the count and the glint are `aria-hidden`; a face that's going is `inert`.

## Content

- Say what was done, in the past tense, naming what it was done to: "Removed SYN-8", "Made the workstream Gift cards, of 4 items.", "Deleted “Gift cards”, with its 2 threads."
- Name a workstream or thread in curly quotes; an item by its key.
- When it can't be undone, say why in one sentence: "It's no longer in the window, so it can't come back."
- The action is one word: **Undo**, **Back**, **Dismiss**.
- A failure says what couldn't be done and why: "Couldn't apply “…”. {why}", "Couldn't undo adding SYN-23: {why}".
- Applying ends in "…" (U+2026); Applied says it only when the approval's answer does.

## Where the app uses it

- `UndoStack`, `BeadStatus` and `UndoButton` in `packages/web/src/undo-stack.tsx`; the room it makes, `makeRoom`. The time model: `undoMs`, `inShowingOrder` and `latestNote` in `packages/web/src/undos.ts`.
- The window's bead: `WindowUndos` in `packages/web/src/end-workstream.tsx`, on the overview (`OverviewPage` in `packages/web/src/overview-page.tsx`), a workstream's page (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`), and once for the app (`Endings` in `packages/web/src/end-workstream.tsx`). `BeadStatus` is placed once in `packages/web/src/app.tsx`.
- CSS: `.bead-wrap`, `.bead`, `.bead-under`, `.bead-layer`, `.bead-row`, `.bead-said`, `.bead-action`, `.bead-cannot`, `.bead-count`, `.bead-mark`, `.bead-dot`, `.bead-frame`, `.bead-panes`, `.bead-pane`, `.bead-glint` and `.bead-time` in `window.css`; the room, `.shell[data-bead-room] .shell-main` in `window.css`. Tokens: `--bead`, `--bead-radius`, `--duration-morph` and `--ease-spring` in each theme.
- Notes: removals `removed` in `packages/web/src/workstream-page.tsx`; mark done, reopen and delete `endedText` in `packages/web/src/ending.ts`; the panel's adds `addUndos` in `packages/web/src/panel-adds.ts`; approval `approvedText` and `approvedUndos` in `packages/web/src/approved.ts`; a close that failed `closingProblem` in `packages/web/src/close-thread.tsx`.
- `pnpm shots` has a scene for each state, `bead-…`, and one per page's top line, `bead-on-…`.
