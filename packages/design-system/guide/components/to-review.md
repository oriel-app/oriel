---
title: Change set to review, out of view
status: stable
group: Thread
order: 67
classes: to-review, to-review-pill
summary: A small pill floating over a thread's composer while a change set awaiting review is mostly above or below what's on screen; it goes to the nearest one.
---

# Change set to review, out of view

## What it is

A thread can hold several change sets, and one awaiting review can sit far above or below what's on screen. While one is mostly out of view (less than half of it shows, or less than half the screen for one taller than it, and what's behind the composer doesn't show), the pill says so: "1 change set to review above", or below, floating just over the thread's composer. A click glides the page to the nearest one and puts focus on its heading. It goes as soon as none is mostly out of view (OA-260).

It's drawn by `ToReview` in `packages/web/src/to-review.tsx`. Where each change set is comes from an IntersectionObserver over the change sets awaiting review (`toReview` in `packages/web/src/view.ts`), never from scroll events.

## When to use it

- Only on a thread's page, for its own change sets awaiting review: those that offer a step besides a revert, as Needs you counts them.

## When not to

- Not for anything else out of view, such as a held message, a draft or the latest entry. The page keeps the latest entry in view by itself.
- Not as a second note. What the person just did goes in [the bead](/components/bead), at the top.
- Not in the window chat or on a review link's page: neither scrolls through several change sets.

## Anatomy and variants

A column of at most two pills, centred over the composer, `--space-2` above it: one for those above, one for those below. Each is a `button` with an arrow and a count.

```html specimen id=above title="One above" height=160
<main class="thread">
  <form class="composer">
    <div class="to-review">
      <button type="button" class="to-review-pill">
        <span aria-hidden="true">↑</span>1 change set to review above
      </button>
    </div>
    <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
    <button type="submit" class="button primary" disabled>Send</button>
  </form>
</main>
```

```html specimen id=both title="Some above and one below, at 390" height=200 width=390
<main class="thread">
  <form class="composer">
    <div class="to-review">
      <button type="button" class="to-review-pill">
        <span aria-hidden="true">↑</span>2 change sets to review above
      </button>
      <button type="button" class="to-review-pill">
        <span aria-hidden="true">↓</span>1 change set to review below
      </button>
    </div>
    <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
    <button type="submit" class="button primary" disabled>Send</button>
  </form>
</main>
```

- **The column** (`.to-review`): absolute, over the composer (`.thread .composer` is sticky, so it holds it), centred. It never covers the composer, the bead at the top, or the selection bar, which isn't on a thread's page.
- **A pill** (`.to-review-pill`): `--surface`, a `--border-thin` hairline in `--accent`, `--radius-lg`, `--shadow`; `--text-sm`, medium, in `--accent`, on one line. The accent means "your move": a change set to review.

## States

```html specimen id=hover title="Hover" state=hover height=160
<main class="thread">
  <form class="composer">
    <div class="to-review">
      <button type="button" class="to-review-pill ws-hover">
        <span aria-hidden="true">↓</span>1 change set to review below
      </button>
    </div>
    <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
    <button type="submit" class="button primary" disabled>Send</button>
  </form>
</main>
```

- **Rest:** shown while one is out of view; it fades up as it comes (`--duration-quick`).
- **Hover:** `--accent-soft`.
- **Focus:** the window's focus ring.
- **None out of view:** no pill at all, not an empty one.
- **Reduced motion:** it shows without fading, and the page jumps to the change set instead of gliding (`perform` in `packages/web/src/effects.ts`).

## Keyboard and ARIA

- Each pill is a button, reached with Tab from the chat before the composer's field. Enter or Space goes to the nearest change set: the last of those above, the first of those below.
- Focus moves to that change set's heading ("Proposed change", or "Undo" for a revert), so a screen reader starts there and the next Tab is its first step.
- The arrow is `aria-hidden`; the words say the direction.
- It's not a live region: it changes as the page scrolls, and reading it out each time would be noise.

## Content

- "{n} change set(s) to review above" or "below", counted, in the glossary's words. Never "pending", "unreviewed" or "new".

## Where the app uses it

- `ToReview` in `packages/web/src/to-review.tsx`, given the thread's change sets awaiting review by `ThreadPage` in `packages/web/src/thread-page.tsx`, and drawn by `Composer` over its field. A click sends `toReviewClicked`; `goingTo` in `packages/web/src/thread.ts` asks for the glide.
- With After you approve set to go on, `approvedIn` in `packages/web/src/approved.ts` glides the same way to the next change set to review in the same thread (`nextToReview` in `packages/web/src/thread.ts`) before it moves to another thread.
- CSS `.to-review` and `.to-review-pill` in `window.css`.
