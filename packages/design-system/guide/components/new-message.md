---
title: New message
status: stable
group: Thread
order: 68
classes: composer-pills, new-message-pill
summary: How a chat scrolls as messages arrive: it follows only while the person is at its latest entry; reading further up, it stays put, and a pill over the composer says something new came and goes to it.
---

# New message

## What it is

A chat follows what arrives (a new message, an answer as it streams, "Working…") only while the person is at its latest entry, within 40px of its end. Scrolled further up, the chat stays exactly where it is, and a pill floats over the composer: "↓ New message". A click takes the chat to its latest entry and puts the pill away; scrolling there by hand puts it away too. From there, the chat follows again (OA-350).

The person's own message always takes the chat to its latest entry, from anywhere, as sending a held message does.

## The scroll rule

One rule for every chat, in the thread's model (`packages/web/src/thread.ts`): `atLatest` says the chat is at its latest entry, `scrolled` keeps it, `keptAtLatest` asks the page to stay there as what arrives renders, and `seen` is the last entry there was while it was. `unseen` is true while the chat is elsewhere and something came after `seen`. `watchLatest` and the `showLatest` effect in `packages/web/src/effects.ts` read and move the chat's scroller: the window on a thread's page, its entries in the window chat.

- **At the latest entry:** what arrives keeps the chat at its end. No pill.
- **Scrolled up, or gone to a change set:** nothing arriving moves the chat, above or below what shows. The pill shows from the first entry that arrives.
- **Opened at a change set** (a review link in the address): what's there is seen; only what arrives after shows the pill.

## When to use it

- Over a chat's composer: a thread's page, beside an item or not, and the window chat, beside the overview, beside an item, or as a sheet.

## When not to

- Not in the item panel's dock: it shows the latest answer's first two lines, which don't scroll.
- Not for a change set out of view: that's [its own pill](/components/to-review), in the same column.
- Not as a note. What the person just did goes in [the bead](/components/bead).

## Anatomy and variants

```html specimen id=thread title="Over a thread's composer" height=160
<main class="thread">
  <div class="chat-dock">
    <form class="chat-input" data-elevation="raised">
      <div class="composer-pills">
        <button type="button" class="new-message-pill">
          <span aria-hidden="true">↓</span>New message
        </button>
      </div>
      <textarea
        class="chat-input-field"
        rows="2"
        placeholder="Ask about 17 items…"
        aria-label="Message"
      ></textarea>
      <div class="chat-input-foot">
        <span class="chat-input-reads">Reads 17 items · v3</span>
        <button type="submit" class="button" disabled>Send</button>
      </div>
    </form>
  </div>
</main>
```

```html specimen id=both title="Under a change set to review, at 390" height=200 width=390
<main class="thread">
  <div class="chat-dock">
    <form class="chat-input" data-elevation="raised">
      <div class="composer-pills">
        <button type="button" class="to-review-pill">
          <span aria-hidden="true">↑</span>1 change set to review above
        </button>
        <button type="button" class="new-message-pill">
          <span aria-hidden="true">↓</span>New message
        </button>
      </div>
      <textarea
        class="chat-input-field"
        rows="2"
        placeholder="Ask about 17 items…"
        aria-label="Message"
      ></textarea>
      <div class="chat-input-foot">
        <span class="chat-input-reads">Reads 17 items · v3</span>
        <button type="submit" class="button" disabled>Send</button>
      </div>
    </form>
  </div>
</main>
```

- **The column** (`.composer-pills`): absolute, `--space-2` over the composer, centred, a column with `--space-2` between pills. The composer holds it: the thread's dock (`.chat-dock > .chat-input`) or the window chat's (`.window-chat > .chat-input`). Empty, it shows nothing.
- **The pill** (`.new-message-pill`): the [to-review pill](/components/to-review)'s shape (`--surface`, `--radius-lg`, `--shadow`, `--text-sm`, medium, one line), with a `--line-strong` hairline and `--text`: nothing to decide, only to read, so not the accent.

## States

```html specimen id=hover title="Hover" state=hover height=160
<main class="thread">
  <div class="chat-dock">
    <form class="chat-input" data-elevation="raised">
      <div class="composer-pills">
        <button type="button" class="new-message-pill ws-hover">
          <span aria-hidden="true">↓</span>New message
        </button>
      </div>
      <textarea
        class="chat-input-field"
        rows="2"
        placeholder="Ask about 17 items…"
        aria-label="Message"
      ></textarea>
      <div class="chat-input-foot">
        <span class="chat-input-reads">Reads 17 items · v3</span>
        <button type="submit" class="button" disabled>Send</button>
      </div>
    </form>
  </div>
</main>
```

- **Rest:** shown once something arrives below; it fades up as it comes (`--duration-quick`).
- **Hover:** `--surface-hover`.
- **Focus:** the window's focus ring.
- **At the latest entry:** no pill.
- **Reduced motion:** it shows without fading, and the chat jumps to its latest entry instead of gliding.

## Keyboard and ARIA

- A button, reached with Tab before the composer's field. Enter or Space goes to the latest entry.
- The arrow is `aria-hidden`; the words say what's there.
- It's not a live region: the chat's own "Working…" status already says the agent is answering.

## Content

- "New message", one for any number. Never a count, "unread" or "jump to bottom".

## Where the app uses it

- `NewMessage` in `packages/web/src/new-message.tsx`, drawn while `unseen` holds by `ThreadPage` in `packages/web/src/thread-page.tsx` and `WindowChat` in `packages/web/src/window-chat-view.tsx`, over the composer through `ChatInput`'s `above`. A click sends `latestClicked`.
- The shots scenes `chat-new-message-thread` and `chat-new-message-window`, and their `-shown`, check the rule in a browser.
- CSS `.composer-pills` and `.new-message-pill` in `window.css`.
