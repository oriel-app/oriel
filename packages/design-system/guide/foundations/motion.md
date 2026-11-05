---
title: Motion
order: 40
summary: Two durations and one easing. Quick for a state, move for a place, and a spring for the bead's shape. One pulse for work in progress, and one reduced-motion block that stills every move.
---

# Motion

Oriel moves little. A dense tool read all day shouldn't make people wait for it, or pull their eye to something that isn't news. Motion says one of two things: a state changed here, or something arrived from somewhere. A third, the pulse, says work is going on.

## The tokens

"Motion: quick for a state, move for a place, and how a move settles" (`:root` in `window.css`).

- `--duration-quick` (120ms): **a state**. Something changes where it is: a chevron turns, a switch flips, a hidden action fades in, a list dims while it reloads.
- `--duration-move` (180ms): **a place**. Something travels or arrives: the item panel slides in, the window chat arrives, the sidebar folds, the drawer opens, a swiped row slides.
- `--ease-out` (`cubic-bezier(0.2, 0.8, 0.2, 1)`): how a move settles, fast then gentle. Use it for anything that arrives.
- `--duration-morph` (440ms) and `--ease-spring`, a sampled damped spring about 5% over, as a `linear()` easing: **a shape that changes** (decision 0056). Only [the bead](/components/bead) uses them, as it grows from a dot and changes shape between notes.

They're shared: no theme changes them. A rule may not write a duration as a literal, since Oriel's theme check fails it. Keyframe durations are the exception: the pulse's is the shared `--pulse` (1.6s), and the spinner's and the install bar's are literals. See [Drift](#drift).

```live
tokens motion
```

## What moves

- **The item panel** (`.item-panel` in `window.css`) slides in from `--slide-panel` (0.375rem) to the right and fades in, at move speed with `--ease-out`. Its contents fade in again for each item it shows (`panel-fade`).
- **The window chat** (`.window-chat` in `window.css`) arrives the same way. On a narrow screen it's a bottom sheet that rises `--space-6` (`@starting-style` in `window.css`).
- **The sidebar's fold** (`.shell` in `window.css`): its grid column narrows to icons, at move speed.
- **The drawer** on a narrow screen slides in from the left, and its scrim fades. Closing, it stays visible until the move ends, then leaves the tab order (`.sidebar` in `window.css`).
- **A swipe** (`.swipe-row` in `window.css`) slides a row left to show its actions. While a finger holds it, it follows at once with no transition.
- **Chevrons** turn 90° when their disclosure opens, at quick speed.
- **The switch** (`.switch` in `window.css`) slides its knob and fills its track, at quick speed with `--ease-out`.
- **The bead** (`.bead` in `window.css`) shows as a dot for a moment, then grows on the spring, and changes shape between notes; its words come in with a 2px blur and go faster than they came, and arriving, they wait for the shape to settle and grow a little as they come (`.bead-wrap[data-arriving]`). Its times are `calc()` over the motion tokens. A failure settles with `--ease-out`, not the spring. Going, it shrinks back to the dot and fades. All caught up plays its one flourish once: the mark draws, its panes light, and a glint crosses it, in about 1.6s.
- **Fades:** a hidden row action appearing, Browse's clusters dimming to 0.55 while a grouping loads, and Needs you's background flashing the accent tint once when the overview's count points at it.

Entries use `@starting-style`: the panel and the chat are drawn at their start (transparent, offset) for their first frame, then transition to rest. There's no script. An engine without `@starting-style` (Safari before 17.5, Firefox before 129) just shows them at rest, which is fine.

Every transition and animation in window.css now:

```live
motion
```

## The one pulse

"The one pulse: a working dot, a thread's state at a glance" (`@keyframes pulse` in `window.css`). The keyframes take the opacity to 0.3 and back, once every `--pulse` (1.6s), wherever it runs. It means **work is going on that the person is waiting for**:

- the working dot beside "Working…" in a thread and the window chat (`.working .working-dot` in `window.css`);
- a state dot whose thread waits on the agent mid-turn or on an apply (`.state-dot:is([data-waiting="agent"], [data-waiting="apply"])` in `window.css`);
- Sync now's icon while it syncs (`.sync-now[aria-busy] .icon` in `window.css`);
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

The bead (decision 0056) is in it: it only fades. It arrives at its size, swaps its words at once, shows its marks drawn and its panes lit, and fades out where it is, with no spring, no glint and no hairline, and the page's move to make room for it is instant.

Two gaps:

- The window chat is listed for `transition: none`, so under reduced motion it loses its fade too, while the item panel keeps its own. The block's comment promises the fade for "the panel". Giving `.window-chat` the panel's `transition-property: opacity` would match them.
- Not covered, on purpose, as fades and colour: Needs you's `shown` flash, Browse's clusters dimming, the row actions' reveal and the panel's `panel-fade`.

## Drift

- **Three easings.** The panel, the chat and the switch use `--ease-out`. The sidebar, drawer, swipe and the chevrons inside the sidebar use `ease`. `.chevron`, `.clusters` and `.make-workstream` use the default. Use `--ease-out` for anything new.
- **Keyframe durations are literals**: the spinner's 0.9s and the install bar's 1.8s. They're the only durations outside the tokens.

## Rules

- **Do** use `--duration-quick` for a state changing in place, and `--duration-move` with `--ease-out` for something arriving.
- **Do** add anything that moves to the one reduced-motion block.
- **Do** keep the pulse for work in progress that the person is waiting on.
- **Don't** animate to get attention. Something waiting on the person is the accent, and holds still.
- **Don't** write a literal duration in a transition.
- **Don't** add a second `@media (prefers-reduced-motion)` block, or a second pulse, or a pulse at its own speed: use `--pulse`.
- **Don't** make anyone wait for an animation before they can act.
