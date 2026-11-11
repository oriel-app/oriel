---
title: Motion
order: 40
summary: Three durations and two easings. Quick for a state, move for a place, morph and the spring for a flourish. When things move and when they never do, how a drag, a menu and an arrival move, one pulse for work in progress, and one reduced-motion block that stills every move.
---

# Motion

Oriel moves little. A dense tool read all day shouldn't make people wait for it, or pull their eye to something that isn't news. Motion says one of two things: a state changed here, or something arrived from somewhere. A third, the pulse, says work is going on.

The bar is "a little life, never obnoxious" (2026-11-08): nothing takes over 200ms but a drop's settle and the bead's flourish, no overshoot you'd notice the tenth time, and nothing delays a click.

## The tokens

"Motion: quick for a state, move for a place, and how a move settles" (`:root` in `window.css`).

- `--duration-quick` (120ms): **a state**. Something changes where it is: a chevron turns, a switch flips, a hidden action fades in, a list dims while it reloads.
- `--duration-move` (180ms): **a place**. Something travels or arrives: the window chat arrives, the sidebar folds, the drawer opens, a swiped row slides.
- `--ease-out` (`cubic-bezier(0.2, 0.8, 0.2, 1)`): how a move settles, fast then gentle. Use it for anything that arrives.
- `--duration-morph` (440ms) and `--ease-spring`, a sampled damped spring about 5% over, as a `linear()` easing: **a small flourish** (decision 0056). Only [the bead](/components/bead) uses them, for its count's pop and its caught-up mark. Its shape moves on springs of its own, in script (see below).

Shorter and longer steps are written from these, never as new numbers: a menu leaves, and a card dropped nowhere goes back, in two thirds of quick (`calc(var(--duration-quick) * 2 / 3)`, 80ms), a drop settles in four thirds of move (240ms), and arrivals stagger by a fifth of quick (24ms).

They're shared: no theme changes them. A rule may not write a duration as a literal, since Oriel's theme check fails it. Keyframe durations are the exception: the pulse's is the shared `--pulse` (1.6s), and the spinner's and the install bar's are literals. See [Drift](#drift).

```live
tokens motion
```

## What moves

- **The item panel** (`.item-panel` in `window.css`) slides in from `--slide-panel` (0.375rem) to the right and fades in, at quick speed (`--duration-quick`) with `--ease-out`: a click on an item should feel answered at once (2026-11-08). Its contents fade in again for each item it shows (`panel-fade`), at the same speed.
- **The window chat** (`.window-chat` in `window.css`) arrives the same way, but at move speed. On a narrow screen it's a bottom sheet that rises `--space-6` (`@starting-style` in `window.css`).
- **The window chat beside an item.** At 1100px and up, opening an item from the chat moves the chat into the page column: the item arrives at the window's edge as above, and the chat slides left into the column at move speed with `--ease-out` (its `left` and `right`), over the overview, which is hidden once it's covered. Closing the item reverses it: the overview is back at once, and the chat slides back to the right. Swapping items moves nothing: only the panel's contents fade (`panel-fade`). Nothing waits on the slide.
- **The item panel's dock** (`.panel-dock` in `window.css`), below 1100px over a conversation, arrives with the panel, rising `--space-1` as it fades in (`arrive`). Folded with Chat, the panel leaves at once and the item's line above the composer (`.panel-folded`) arrives the same way; Show brings the panel back as it first came.
- **The sidebar's fold** (`.shell` in `window.css`): its grid column narrows to icons, at move speed.
- **A change set folding itself** (`.change-set[data-closing]` in `window.css`): once its apply ends on screen and a 1.2s beat has passed, everything under its head closes to nothing and fades, at move speed with `--ease-out`, then it folds. Under reduced motion it folds at once.
- **The drawer** on a narrow screen slides in from the left, and its scrim fades. Closing, it stays visible until the move ends, then leaves the tab order (`.sidebar` in `window.css`).
- **A swipe** (`.swipe-row` in `window.css`) slides a row left to show its actions. While a finger holds it, it follows at once with no transition.
- **Chevrons** turn 90° when their disclosure opens, at quick speed.
- **The switch** (`.switch` in `window.css`) slides its knob and fills its track, at quick speed with `--ease-out`.
- **The bead** is the one thing moved by script, on springs (`advance` in `packages/web/src/bead-motion.ts`; decision 0056, amended): it drops from the frame's band as a small bead, spreads to its note's width, and its words fade in, unblurring; height leads with a little overshoot, width follows, softer. A new note reflows it and swaps its words. Leaving, its words go first, it narrows back, and the band takes it back. At rest it's still, but for its swell under the pointer, and no animation frame runs. The springs step in whole ticks, so they land in the same place at any frame rate. All caught up plays its one flourish once: the mark draws, its panes light, and a glint crosses it, in about 1.6s. See [The bead](/components/bead#motion).
- **A dragged item** rides on a card (`.drag-card` in `window.css`, `lift` in `packages/web/src/drag-card.ts`), the one other thing moved by script. See [Drag](#drag).
- **Menus** grow from where they opened and leave quicker. See [Menus](#menus).
- **Arrivals** (`.arrive` in `window.css`): something that shows up in place, as what a new thread's workstream holds once it's picked, fades in and rises `--space-1`, at move speed with `--ease-out`. Siblings that arrive together stagger, each a fifth of quick after the one before, up to the sixth, so a long list is never slow to show. A list that reloads in place doesn't arrive: only what's new to the person does.
- **Fades:** a hidden row action appearing, Browse's clusters dimming to 0.55 while a grouping loads, and Needs you's background flashing the accent tint once when the overview's count points at it.

Entries use `@starting-style`: the panel and the chat are drawn at their start (transparent, offset) for their first frame, then transition to rest. There's no script, but for the bead. An engine without `@starting-style` (Safari before 17.5, Firefox before 129) just shows them at rest, which is fine.

Every transition and animation in window.css now:

```live
motion
```

## Drag

An item dragged to a workstream (see [Drag to move](/patterns/drag-to-move)) is on a card of its own, so it can move as a held thing does:

- **It leans with the pull.** About 3°, never more than 4° (`leanStep` in `drag-card.ts`), clockwise as it's pulled right, as a card held at its left edge trails. It eases back to level when the pointer stops. The pull and the lean follow on short exponential lags (50ms and 100ms), stepped by real time, so they look the same at any frame rate.
- **It's cheap.** A dragover only notes where the pointer is; one animation frame moves the card by its `transform`, and nothing reads layout but at the start. It's in the top layer (a manual popover), so nothing clips it, and the pointer passes through it.
- **Dropped, it's set down.** It comes level, shrinks to 94% and fades, in 240ms on `--ease-spring`, the one tiny overshoot.
- **Dropped nowhere, it goes back at once.** It slides toward its row and fades as it goes, in 80ms; the row, dimmed while it was away, comes back. The page takes every drop of an item, its own places or not (`anywhere` in `drag-item.ts`), so the system never refuses one: macOS slides a refused drag back to where it started before the drag ends, and the card would wait on it for most of a second (OA-314).

## Menus

[Context menus](/components/menu#motion), and a menu a drop opens, come from where they opened: `transform-origin` at the pointer or the control, a scale from 96% and a fade, at quick speed with `--ease-out`. They close quicker, in 80ms, and can't be clicked while they go. It's on `.context-menu` once, so every `Menu` has it.

The browser draws a `<select>`'s list itself (see [Select](/components/select)), so its list doesn't move, and that's fine.

## What never moves

- Text as you read it: a page's contents don't slide or fade when you open the page, and a list that reloads holds still.
- Anything under a pointer or a finger that's acting on it, but the swipe and the drag, which follow it at once.
- Something waiting on the person: it's the accent and holds still (see the pulse below).
- A settled screen. Every animation ends; the shots take their pictures with animations finished, and motion must never change one.

## The one pulse

"The one pulse: a working dot, a thread's state at a glance" (`@keyframes pulse` in `window.css`). The keyframes take the opacity to 0.3 and back, once every `--pulse` (1.6s), wherever it runs. It means **work is going on that the person is waiting for**:

- the working dot beside "Working…" in a thread and the window chat (`.working .working-dot` in `window.css`);
- a state dot whose thread waits on the agent mid-turn or on an apply (`.state-dot:is([data-waiting="agent"], [data-waiting="apply"])` in `window.css`);
- Sync workstream now's icon while it syncs (`.sync-now[aria-busy] .icon` in `window.css`);
- the bead's working dot (`.bead-dot` in `window.css`).

Nothing else pulses. "Only an agent mid-turn, or a change set applying, pulses; a change set to review or stalled applying, or a reason held for the person, stands out" (`.state-dot:is([data-waiting="agent"], [data-waiting="apply"])` in `window.css`). Something waiting on the person is the accent and holds still. A pulse is never for attention.

Two other busy marks turn or slide, for waits the person didn't start in a thread: the `.spinner` (a ring turning every 0.9s) while a connection or the first run waits on a browser, and the `.cli-bar`, which "moves to show it's going, never how far" while Claude Code downloads (`.cli-bar` in `window.css`).

```html specimen id=busy title="Busy: the pulse, the spinner, the install bar"
<div class="ws-stack">
  <p class="working" role="status"><span class="working-dot"></span> Working…</p>
  <p class="ws-row" style="margin: 0">
    <span class="state-dot" data-state="working" data-waiting="agent"></span>
    <span>Agent working (a state dot)</span>
  </p>
  <p class="cli-line cli-waiting" role="status">
    <span class="spinner" aria-hidden="true"></span>
    Waiting for you in your browser…
  </p>
  <div class="cli-progress">
    <span class="cli-bar" aria-hidden="true"></span>
    <span class="cli-note"
      >Downloading → setting up → checking it's genuine. About 310 MB, usually a minute or two,
      straight from Anthropic.</span
    >
  </div>
</div>
```

```html specimen id=quick title="Quick: a switch flips (click it)"
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="true"
    aria-label="Notify me when a thread needs me"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <span>Notify me when a thread needs me</span>
</div>
```

## Reduced motion

`prefers-reduced-motion` is handled once, in one block (decision 0034, `@media (prefers-reduced-motion: reduce)` in `window.css`). It stills every move and the pulse, and keeps the panel's fade, since a fade doesn't move anything:

```live
reduced-motion
```

The block is the last thing in `window.css`, so it wins over every rule above it of the same weight; a rule written after it would win back. A new transition or animation that moves something must be added to this block, never to a block of its own. A fade or a colour change may stay.

The bead (decision 0056, amended) reads the same query in script (`reducedMotion` in `packages/web/src/undo-stack.tsx`): it only fades. It arrives at its size, swaps its words at once, and fades out where it is, with no drop or spread. The block shows its marks drawn and its panes lit, with no glint.

The drag card follows the pointer level, with no lean (`reduced` in `drag-card.ts`); dropped, it only fades, and dropped nowhere it goes back to its row at once. Menus only fade, with no scale (`.context-menu` in the block). Arrivals fade, all together, with no rise or stagger (`.arrive`, which takes `panel-fade`), and so do the panel's dock and the folded item line (`.panel-dock`, `.panel-folded`).

The window chat keeps its fade as the item panel does (`transition-property: opacity`), so beside an item it moves to the column at once, and the overview under it hides at once.

One gap:

- Not covered, on purpose, as fades and colour: Needs you's `shown` flash, Browse's clusters dimming, the row actions' reveal and the panel's `panel-fade`.

## Drift

- **Three easings.** The panel, the chat and the switch use `--ease-out`. The sidebar, drawer, swipe and the chevrons inside the sidebar use `ease`. `.chevron`, `.clusters` and `.make-workstream` use the default. Use `--ease-out` for anything new.
- **Keyframe durations are literals**: the spinner's 0.9s and the install bar's 1.8s. They're the only durations outside the tokens.

## Rules

- **Do** use `--duration-quick` for a state changing in place, and `--duration-move` with `--ease-out` for something arriving.
- **Do** add anything that moves to the one reduced-motion block.
- **Do** make a menu come from where it opened, and leave quicker than it came.
- **Do** move by `transform` and `opacity` only, and read layout before a drag or an animation, never during it.
- **Do** keep the pulse for work in progress that the person is waiting on.
- **Don't** animate to get attention. Something waiting on the person is the accent, and holds still.
- **Don't** write a literal duration in a transition.
- **Don't** add a second `@media (prefers-reduced-motion)` block, or a second pulse, or a pulse at its own speed: use `--pulse`.
- **Don't** make anyone wait for an animation before they can act.
