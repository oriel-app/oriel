---
title: The bead
status: stable
group: Feedback
order: 64
classes: bead-wrap, bead-shape, bead, bead-layer, bead-row, bead-said, bead-action, bead-cannot, bead-count, bead-mark, bead-dot, bead-frame, bead-panes, bead-pane, bead-glint
summary: Oriel's one toast. The frame's own material, grown down from the band at the top centre of the page column, saying what was just done, with its Undo; F8 reaches it, ⌘Z undoes the newest.
---

# The bead

## What it is

The bead (decision 0056, amended) is where the window's one stack of Undo notes shows. It's the [frame](/components/frame)'s own material, growing out of the band along the page column's top: "It drops as a small bead and spreads to say the newest note, with a count and the material's lips beneath it while there are more; a new note reflows it and swaps its words; and as the last one goes, its words go first, it narrows back to the bead, and the band takes it back" (`UndoStack` in `packages/web/src/undo-stack.tsx`). "Bead" names the place; what it says is still a note.

A note (`UndoNote` in `packages/web/src/undos.ts`) is a sentence and one action:

- **Undo**, which takes back what the sentence says, with its key (⌘Z or Ctrl+Z) beside it;
- or a **link** in Undo's place, such as Back to the thread an approval moved on from;
- or, when it can't be undone, **why not** (`.bead-cannot`, faint);
- or nothing.

An approval's note carries a **mark**: Applying, with a pulsing dot; Applied, with a check that draws itself; or All caught up, with Oriel's own mark. A failure is one more thing the bead says, with a danger mark and **Dismiss**, until it's dismissed.

It's Oriel's only toast. A note that keeps its key changes in the one shape: Applying becomes Applied, and a failed apply its problem.

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

Drawn here in a crop of the window's top: a column 560px wide, set into the frame. In the window it centres on the page column, clear of the sidebar, and of the item panel or window chat where either lies over the page. Its shape is drawn by script each frame (`beadPath` in `packages/web/src/bead-motion.ts`), so each specimen carries the shape the bead rests at, and the room, offset and clip `UndoStack` sets.

```html specimen id=note title="A note, with its Undo and key" height=96
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
          id="cast-note"
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
        filter="url(#cast-note)"
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

- **The wrap** (`.bead-wrap`, `role="region"`, "Notes"): fixed at the band's lower edge (`--frame-top`), as wide as what's left of the column, with no height; the bead hangs from it, and it takes no pointer. `data-tone` is the face's tone (`note`, `applying`, `applied`, `caught-up` or `problem`), `data-count` how many it holds, up to 3. `data-moving` is on it while anything moves, and `data-reduced` under reduced motion.
- **The shape** (`.bead-shape`): one SVG over the column's top, in `--frame`, with the frame's cast shadow (`--frame-shade`). Its body is as wide as its words and `--bead-height` tall at rest, its lower corners `--bead-radius`. At each side a neck runs into the band, `--bead-neck` along it once spread. It reaches a little up into the band, so no seam shows.
- **Its words** (`.bead`): laid out at their rested size and centred on whole pixels, so they never move with the shape. A clip, set as the shape moves (`wordsClip` in `packages/web/src/bead-motion.ts`), reveals them. Only they take the pointer.
- **A face** (`.bead-layer`): one line, at most `--bead-room` wide, `--bead-height` tall at least, `--text-md`.
- **A row** (`.bead-row`): the mark, the sentence (`.bead-said`) and the action.
- **The action** (`.bead-action`): Undo, Back or Dismiss, in `--accent`, strong, rounded as the bead is (`--bead-radius`), with its key in a `kbd`, faint, hidden on touch and on a narrow screen.
- **Why not** (`.bead-cannot`): faint, `--text-sm`, in the action's place.

It writes in the page's own colours on the frame: `--text`, `--text-muted`, `--text-faint`, `--accent` and the states, each 4.5:1 or more on `--frame` in every theme and scheme (Oriel's theme check holds them to it). See [Colour](/foundations/colour).

```html specimen id=cannot title="A note that can't be undone, says why" height=96
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
          id="cast-cannot"
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
        filter="url(#cast-cannot)"
        d="M51,-2V0C58.18,0 64,5.82 64,13V28C64,36.84 71.16,44 80,44H480C488.84,44 496,36.84 496,28V13C496,5.82 501.82,0 509,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 64px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-10</span
          ><span class="bead-cannot">It's no longer in the window, so it can't come back.</span>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Never past the frame

It's never wider than the column less, on each side, the corner's curve, a neck and `--bead-gap` (`room` in `packages/web/src/bead-motion.ts`), and it's measured again whenever the column's width changes, as the window resizes, the sidebar folds or the panel opens, so it reflows rather than run into the sidebar's corner. Cut short, its sentence ends in an ellipsis and keeps all its words for a screen reader. Its action is never cut. On a narrow screen the secondary words go first: the key, and why a note can't be undone.

```html specimen id=narrow title="On a phone, from the bar: cut short, its Undo whole, its key gone" width=390 height=130
<div class="shell" style="--sidebar: 0rem; width: 390px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2">
    <header class="bar">
      <button type="button" class="bar-menu" aria-label="Open the sidebar">
        <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg></button
      ><a class="brand" href="/">Oriel</a>
    </header>
  </div>
  <div class="frame"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="1"
    style="--bead-room: 304px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-narrow"
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
        filter="url(#cast-narrow)"
        d="M30,-2V0C37.18,0 43,5.82 43,13V28C43,36.84 50.16,44 59,44H331C339.84,44 347,36.84 347,28V13C347,5.82 352.82,0 360,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 43px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said"
            >Marked “Checkout v2: phone wallets and saved cards” done, with its thread.</span
          ><button
            type="button"
            class="bead-action"
            aria-label="Undo: Marked “Checkout v2: phone wallets and saved cards” done, with its thread."
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

### An approval

With After you approve set to go on, approving moves the page to the next change set to review in the same thread, or, with none left there, to the next thread that needs the person, and the bead says what happened, with Back when the page left the thread. All caught up only when nothing needs them, that thread included. The mark comes from the approval's own answer, never from the words (`approvedText` in `packages/web/src/approved.ts`).

```html specimen id=applying title="Applying: a pulsing dot, and Back" height=96
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="applying"
    data-count="1"
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-applying"
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
        filter="url(#cast-applying)"
        d="M38,-2V0C45.18,0 51,5.82 51,13V28C51,36.84 58.16,44 67,44H493C501.84,44 509,36.84 509,28V13C509,5.82 514.82,0 522,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 51px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-mark" data-mark="applying"><span class="bead-dot"></span></span
          ><span class="bead-said"
            >You approved “Pay with a phone wallet on the website”. Applying…<span
              class="visually-hidden"
            >
              Now on “Weather alerts”, the next thread that needs you.</span
            ></span
          ><a
            class="bead-action"
            href="/threads/t-23"
            aria-label="Back to “Pay with a phone wallet on the website”"
            >Back</a
          >
        </div>
      </div>
    </div>
  </div>
</div>
```

```html specimen id=applied title="Applied: a check that draws itself" height=96
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="applied"
    data-count="1"
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-applied"
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
        filter="url(#cast-applied)"
        d="M61,-2V0C68.18,0 74,5.82 74,13V28C74,36.84 81.16,44 90,44H470C478.84,44 486,36.84 486,28V13C486,5.82 491.82,0 499,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 74px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <svg class="bead-mark" data-mark="applied" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" />
            <path d="M5 8.3l2.1 2.1L11 6.2" pathLength="1" /></svg
          ><span class="bead-said">Applied “Pay with a phone wallet on the website”.</span
          ><a
            class="bead-action"
            href="/threads/t-23"
            aria-label="Back to “Pay with a phone wallet on the website”"
            >Back</a
          >
        </div>
      </div>
    </div>
  </div>
</div>
```

When nothing else needs the person, the page stays, and the bead plays its one flourish: Oriel's mark draws (`.bead-frame`), its three panes (`.bead-panes`, `.bead-pane`) light one by one, and one glint (`.bead-glint`) crosses the bead, in about 1.6 s. It plays once.

```html specimen id=caught-up title="All caught up" height=96
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="caught-up"
    data-count="1"
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-caught-up"
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
        filter="url(#cast-caught-up)"
        d="M194.5,-2V0C201.68,0 207.5,5.82 207.5,13V28C207.5,36.84 214.66,44 223.5,44H336.5C345.34,44 352.5,36.84 352.5,28V13C352.5,5.82 358.32,0 365.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 208px; clip-path: none">
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
            <path class="bead-frame" d="M2.5 8.5h15M10 8.5v9" pathLength="1" /></svg
          ><span class="bead-said">All caught up.</span>
        </div>
        <span class="bead-glint"></span>
      </div>
    </div>
  </div>
</div>
```

### Several notes

With more than one, the bead shows the newest, with a count (`.bead-count`) that pops as each arrives, and one or two of the material's lips beneath it, each narrower and a little lower (`lipPath` in `packages/web/src/bead-motion.ts`).

```html specimen id=several title="Three notes: the newest, a count and two lips" height=104
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="3"
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-several"
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
        filter="url(#cast-several)"
        d="M174.5,24V36C174.5,44.84 181.66,52 190.5,52H369.5C378.34,52 385.5,44.84 385.5,36V24Z"
      />
      <path
        filter="url(#cast-several)"
        d="M164.5,24V32C164.5,40.84 171.66,48 180.5,48H379.5C388.34,48 395.5,40.84 395.5,32V24Z"
      />
      <path
        filter="url(#cast-several)"
        d="M141.5,-2V0C148.68,0 154.5,5.82 154.5,13V28C154.5,36.84 161.66,44 170.5,44H389.5C398.34,44 405.5,36.84 405.5,28V13C405.5,5.82 411.32,0 418.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 155px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <span class="bead-count" aria-hidden="true">3</span>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-104</span
          ><button
            type="button"
            class="bead-action"
            aria-label="Undo removing SYN-104"
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

Pointer or focus on it opens them as a list, newest first, nearest the band, each with its own Undo, and the shape grows to it; the lips go. Only the newest carries the key. Held open, it may hang over the page: that is the person's doing.

```html specimen id=held title="Held open: a list, newest first" height=150
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="note"
    data-count="3"
    data-open
    data-held
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-held"
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
        filter="url(#cast-held)"
        d="M156.5,-2V0C163.68,0 169.5,5.82 169.5,13V92C169.5,100.84 176.66,108 185.5,108H374.5C383.34,108 390.5,100.84 390.5,92V13C390.5,5.82 396.32,0 403.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 170px; clip-path: none">
      <div class="bead-layer" tabindex="-1" data-list>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-104</span
          ><button
            type="button"
            class="bead-action"
            aria-label="Undo removing SYN-104"
            aria-keyshortcuts="Meta+Z"
          >
            Undo<kbd>⌘Z</kbd>
          </button>
        </div>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-99</span
          ><button type="button" class="bead-action" aria-label="Undo removing SYN-99">Undo</button>
        </div>
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span
          ><button type="button" class="bead-action" aria-label="Undo removing SYN-23">Undo</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

### A failure

What failed: a danger mark, the problem and Dismiss. It stays until dismissed, wherever the page goes. It takes its place among the notes by when it showed. A close from a list that failed is one of these (`closingProblem` in `packages/web/src/close-thread.tsx`), not a box of its own.

```html specimen id=problem title="A close from a list that failed" height=96
<div class="shell" style="--sidebar: 0rem; width: 564px; min-height: 0; height: 100vh">
  <div class="shell-main" style="grid-column: 2"></div>
  <div class="frame" style="right: auto; width: 560px"></div>
  <div
    class="bead-wrap"
    role="region"
    aria-label="Notes"
    aria-keyshortcuts="F8"
    data-tone="problem"
    data-count="1"
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-problem"
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
        filter="url(#cast-problem)"
        d="M67.5,-2V0C74.68,0 80.5,5.82 80.5,13V28C80.5,36.84 87.66,44 96.5,44H463.5C472.34,44 479.5,36.84 479.5,28V13C479.5,5.82 485.32,0 492.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 81px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <svg class="bead-mark" data-mark="problem" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.6" />
            <path d="M8 4.8v3.8M8 11v.2" /></svg
          ><span class="bead-said">The thread changed since this page loaded.</span
          ><button type="button" class="bead-action">Dismiss</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Room at the column's top

The page column's first line starts `--frame-room` down: the band, the bead's resting height and `--space-4`. So a resting bead covers no page head, title or control, on any page, and the page never moves for it (`--inset-top` on `.shell-main` in `window.css`). Under the pointer it swells into that room. Held open as a list, it may hang over the page; on a page scrolled down, it covers what scrolled under the band, as the band does.

## Motion

Springs, not timed curves, a few lines in `packages/web/src/bead-motion.ts`: height leads with a little overshoot, width follows, softer. They step in whole ticks of 1/240 s, so they land in the same place at any frame rate.

- **Arriving:** it drops from the band as a small bead (`--bead-seed`), its necks flaring wide and shallow as it gathers; then it spreads to its note's width, the necks tightening as it spreads, like surface tension letting go. Once it has spread, its words fade in, unblurring.
- **Changing:** a new note while one shows doesn't drop a second. Its words go, the shape reflows to the new ones, and they come in.
- **At rest:** still. Nothing moves but the swell under the pointer, about `--bead-swell`, and Applying's pulsing dot. No animation frame runs at rest, or with no note.
- **Leaving:** its words go first, then it narrows back to the bead, and the band takes it back.
- **Reduced motion:** no drop or spread. It shows at its size and fades in, swaps its words at once, shows its marks drawn, and fades out where it is. No glint.

## States

```html specimen id=state-hover title="Hover: the action's fill, and the bead swells" state=hover height=96
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
    data-held
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-state-hover"
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
        filter="url(#cast-state-hover)"
        d="M168.5,-2V0C175.68,0 181.5,5.82 181.5,13V33C181.5,41.84 188.66,49 197.5,49H362.5C371.34,49 378.5,41.84 378.5,33V13C378.5,5.82 384.32,0 391.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 182px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span
          ><button type="button" class="bead-action ws-hover" aria-label="Undo removing SYN-23">
            Undo
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

```html specimen id=state-focus title="Focus visible: a ring 2px inside the action" state=focus-visible height=96
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
    data-held
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-state-focus"
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
        filter="url(#cast-state-focus)"
        d="M168.5,-2V0C175.68,0 181.5,5.82 181.5,13V28C181.5,36.84 188.66,44 197.5,44H362.5C371.34,44 378.5,36.84 378.5,28V13C378.5,5.82 384.32,0 391.5,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 182px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Removed SYN-23</span
          ><button
            type="button"
            class="bead-action ws-focus-visible"
            aria-label="Undo removing SYN-23"
          >
            Undo
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

```html specimen id=state-busy title="Undoing: disabled, faint" state=busy height=96
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
    data-held
    style="right: auto; width: 560px; --bead-room: 458px"
  >
    <svg class="bead-shape" aria-hidden="true">
      <defs>
        <filter
          id="cast-state-busy"
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
        filter="url(#cast-state-busy)"
        d="M97,-2V0C104.18,0 110,5.82 110,13V28C110,36.84 117.16,44 126,44H434C442.84,44 450,36.84 450,28V13C450,5.82 455.82,0 463,0V-2Z"
      />
    </svg>
    <div class="bead" style="left: 110px; clip-path: none">
      <div class="bead-layer" tabindex="-1">
        <div class="bead-row">
          <span class="bead-said">Marked “Gift cards” done, with its thread.</span
          ><button
            disabled
            type="button"
            class="bead-action"
            aria-label="Undo: Marked “Gift cards” done, with its thread."
          >
            Undo
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
```

- **Rest:** not drawn while there's nothing to say: the bead is only in the page while it has a note, and the band is flat.
- **Held:** while the pointer is on it or focus is in it, nothing runs out (`data-held`). When both let go, every note still showing gets its full 8 seconds again (`undoMs` in `packages/web/src/undos.ts`). Clicking an Undo lets go of the keyboard's hold.
- **Open:** held with more than one note, it opens as the list (`data-open`); the lips go.
- **Leaving:** `data-leaving`, and it takes no pointer.
- **Hover:** the bead swells; an action under the pointer takes `--accent-soft`, guarded by `:not(:disabled)` (`.bead-action:hover:not(:disabled)` in `window.css`).
- **Focus visible:** a ring in `--focus`, 2px inside the action (`.bead-action:focus-visible` in `window.css`).
- **Busy:** an Undo in flight is disabled, in `--text-faint`.
- **Error:** the failure face.
- **Active:** not styled.

## Keyboard and ARIA

- **F8 shows the notes,** from anywhere, a text field included: it focuses the newest note's action, or the face itself when it has none, and focus holds the bead open. Escape goes back to where focus was, and closes nothing behind the bead (`UndoStack` in `packages/web/src/undo-stack.tsx`). The wrap carries `aria-keyshortcuts="F8"`. F8 is the window's: don't bind it elsewhere.
- ⌘Z on a Mac, Ctrl+Z elsewhere, undoes the newest note that can be undone, from anywhere in the window, but not with Shift or Alt held, and not while typing in a field: "A text field undoes its own typing". That note's Undo carries `aria-keyshortcuts="Meta+Z"` (or `"Control+Z"`) and shows the key, and only that one.
- The bead is a `role="region"` named "Notes", in the tab order only through its actions.
- **One status region,** always there on every page but a review link's: `BeadStatus` in `packages/web/src/undo-stack.tsx`, a visually hidden `role="status"` and `role="alert"`. Each note is read once as it shows, and again only if what it says changes, as Applying to Applied. Its `heard` text, such as "Now on “Weather alerts”, the next thread that needs you.", is read with it. A failure is read through the alert.
- Every Undo's accessible name is what it undoes: "Undo removing SYN-8", "Undo: Deleted “Gift cards”, with its 2 threads.". The visible word is always "Undo". A link's is where it goes: "Back to “Pay with a phone wallet on the website”".
- A sentence cut short keeps its whole text: the ellipsis is only its look.
- The shape, the marks, the count and the glint are `aria-hidden`.

## Content

- Say what was done, in the past tense, naming what it was done to: "Removed SYN-8", "Made the workstream Gift cards, of 4 items.", "Deleted “Gift cards”, with its 2 threads."
- Name a workstream or thread in curly quotes; an item by its key.
- Put what matters first: on a narrow screen the end of a long sentence is what's cut.
- When it can't be undone, say why in one sentence: "It's no longer in the window, so it can't come back."
- The action is one word: **Undo**, **Back**, **Dismiss**.
- A failure says what couldn't be done and why: "Couldn't apply “…”. {why}", "Couldn't undo adding SYN-23: {why}".
- Applying ends in "…" (U+2026); Applied says it only when the approval's answer does.

## Where the app uses it

- `UndoStack`, `BeadStatus` and `UndoButton` in `packages/web/src/undo-stack.tsx`. Its shape and motion: `beadPath`, `lipPath`, `wordsClip`, `room`, `advance` and `frameDriver` in `packages/web/src/bead-motion.ts`. The time model: `undoMs`, `inShowingOrder` and `latestNote` in `packages/web/src/undos.ts`.
- The window's bead: `WindowUndos` in `packages/web/src/end-workstream.tsx`, on the overview (`OverviewPage` in `packages/web/src/overview-page.tsx`), a workstream's page (`WorkstreamPage` in `packages/web/src/workstream-page.tsx`), and once for the app (`Endings` in `packages/web/src/end-workstream.tsx`). `BeadStatus` is placed once in `packages/web/src/app.tsx`.
- CSS: `.bead-wrap`, `.bead-shape`, `.bead`, `.bead-layer`, `.bead-row`, `.bead-said`, `.bead-action`, `.bead-cannot`, `.bead-count`, `.bead-mark`, `.bead-dot`, `.bead-frame`, `.bead-panes`, `.bead-pane` and `.bead-glint` in `window.css`. Tokens: `--frame`, `--frame-shade`, `--frame-corner`, `--frame-corner-narrow` and `--bead-radius` in each theme; `--bead-seed`, `--bead-height`, `--bead-neck`, `--bead-gap`, `--bead-swell` and `--frame-room`, shared.
- Notes: removals `removed` in `packages/web/src/workstream-page.tsx`; mark done, reopen and delete `endedText` in `packages/web/src/ending.ts`; the panel's adds `addUndos` in `packages/web/src/panel-adds.ts`; approval `approvedText` and `approvedUndos` in `packages/web/src/approved.ts`; a rejection in a thread, "You rejected the change in “…”." with Undo, and why an Undo was refused, `rejectedUndos` in `packages/web/src/rejected.ts` (OA-258); a close that failed `closingProblem` in `packages/web/src/close-thread.tsx`.
- `pnpm shots` has a scene for each state, `bead-…`, and one per page's top line, `bead-on-…`. Every shot waits for the bead to rest.
