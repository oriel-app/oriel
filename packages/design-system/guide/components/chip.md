---
title: Chip
status: stable
group: Display
order: 40
classes: chip, chip-link, chip-lead, chip-icon, chip-key, chip-name, chip-state
summary: An item, thread, change set or workstream an agent names in its answer, drawn by Oriel in the line as an icon, its key, its name and where it stands. No box.
---

# Chip

## What it is

When an agent names something in its answer, it writes its ID as `[[id]]`, and Oriel draws a chip in its place (decision 0032). A chip is part of the sentence: an icon for its kind, its key, its name and where it stands, all from what the server resolved, "never from the agent's words" (`packages/web/src/chip.ts`). It opens the item in the [item panel](/components/item-panel), or the thread or workstream.

A chip has no box, no fill and no border. It's words with a small icon and a coloured state, so a line of prose with three chips still reads as a line. "Chip" is the glossary's word for it (SPEC §2). It isn't the thread's state pill, which is a [state chip](/components/badge), a different thing.

There are four kinds, in `data-kind`: `item`, `thread`, `change-set` and `workstream`.

An item's chip is marked while its item is open in the panel (`data-open`, from `OpenItemContext` in `packages/web/src/parts.tsx`): its name underlined in full in `--focus`, and a small open mark after its key, so the person sees which words the item came from. Every chip for that item is marked, and the mark goes when the panel closes or shows another item.

## When to use it

- In an agent's answer, wherever it names an item, a thread, a change set or a workstream. The agent writes the ID; the chip is how it shows.
- In a rows block, for each item, so "an item looks the same in a sentence and in a block" (`packages/web/src/chip.ts`). See [Block](/components/block).
- In the caption of a quote from an item: "Word for word from" or "Quoted from", then the item's chip. See [Message](/components/message).

## When not to

- Not in synced text. An item's own description, a Slack message, the panel's rich text: there `[[…]]` stays text (decision 0032).
- Not for a thread's or an item's state on its own, outside a sentence. A thread list shows a [state chip](/components/badge), and Browse's rows show the item's `.status`.
- Not as a link to something outside Oriel. A chip opens Oriel's view of the thing; Cmd-click is the way to its source.
- Not drawn from the agent's words. A chip's name and state come from the index and Oriel's own data, so they can't be stale or a look-alike ID. If the server didn't resolve it, the chip says so.
- Not inside a box, pill or button frame. Decision 0032: "inline, as part of the line, with no box".

## Anatomy and variants

```html specimen id=in-a-sentence title="Chips in an answer: an item, a change set and a workstream"
<div class="reply">
  <p>
    <span
      class="chip"
      data-kind="item"
      data-state="in-progress"
      title="SYN-23: Pay with a phone wallet on the website, in progress"
      ><a
        class="chip-link"
        href="https://example.atlassian.net/browse/SYN-23"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-23</span></span
        >
        <span class="chip-name">Pay with a phone wallet on the website</span
        ><span class="chip-state">In Progress</span></a
      ></span
    >
    still has no estimate, so
    <span
      class="chip"
      data-kind="change-set"
      data-state="pending"
      title="Change set: Estimate the unestimated checkout stories, waiting"
      ><a
        href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0?changeSet=01JBX5A1B2C3D4E5F6G7H8J9K0"
        class="chip-link"
        aria-label="Change set: Estimate the unestimated checkout stories, waiting"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2" width="11" height="12" rx="2" />
            <path d="M8 4.5v4M6 6.5h4M6 11h4" /></svg
          ><span class="chip-name">Estimate</span></span
        ><span class="chip-name"> the unestimated checkout stories</span
        ><span class="chip-state">Waiting</span></a
      ></span
    >
    leaves it out. Everything else it names is in
    <span
      class="chip"
      data-kind="workstream"
      data-state="open"
      title="Workstream: Checkout v2: phone wallets and saved cards, open"
      ><a
        href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P0"
        class="chip-link"
        aria-label="Workstream: Checkout v2: phone wallets and saved cards, open"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg
          ><span class="chip-name">Checkout</span></span
        ><span class="chip-name"> v2: phone wallets and saved cards</span
        ><span class="chip-state">Open</span></a
      ></span
    >.
  </p>
</div>
```

- **Lead** (`.chip-lead`, `white-space: nowrap`): the kind's icon (`.chip-icon`, 0.875em, stroked in `--text-muted`) and the key (`.chip-key`, strong), which never part. A thread, a change set or a workstream has no key, so its icon keeps the name's first word beside it instead.
- **Name** (`.chip-name`): regular weight, underlined in `--line-strong`. After a key it's `--text-muted`, so the key reads first. Cut at 44 characters, at a word, with "…"; the whole name is in its `title`.
- **State** (`.chip-state`): `--text-xs` medium, after a 0.375rem dot (`::before`), both in the state's colour.
- **Link** (`.chip-link`): an `<a>` around all three, in `--text` with no underline of its own. An item with no web page of its own, such as a file, gets a `<button class="chip-link item-link">` instead.

Icons: a thread is a speech bubble, a change set a diff box, a workstream lines of a list. An item takes its connector's icon: a ticket (the default), a page, a message or a row (`itemIcons` in `packages/web/src/parts.tsx`).

```html specimen id=kinds-and-states title="Every kind, in every state"
<div class="reply">
  <p>An item, by its status category:</p>
  <ul>
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="todo"
        title="SYN-27: Spike: NFC tap-to-board at the linkspan, to do"
        ><a
          class="chip-link"
          href="https://example.atlassian.net/browse/SYN-27"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-27</span></span
          >
          <span class="chip-name">Spike: NFC tap-to-board at the linkspan</span
          ><span class="chip-state">To Do</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="in-progress"
        title="SYN-23: Pay with a phone wallet on the website, in progress"
        ><a
          class="chip-link"
          href="https://example.atlassian.net/browse/SYN-23"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-23</span></span
          >
          <span class="chip-name">Pay with a phone wallet on the website</span
          ><span class="chip-state">In Progress</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="item"
        data-state="done"
        title="SYN-22: Give the map pins accessible labels, done"
        ><a
          class="chip-link"
          href="https://example.atlassian.net/browse/SYN-22"
          target="_blank"
          rel="noopener noreferrer"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
              <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
            ><span class="chip-key">SYN-22</span></span
          >
          <span class="chip-name">Give the map pins accessible labels</span
          ><span class="chip-state">Done</span></a
        ></span
      >
    </li>
  </ul>
  <p>A thread:</p>
  <ul>
    <li>
      <span
        class="chip"
        data-kind="thread"
        data-state="needs-you"
        title="Thread: Estimate the unestimated checkout stories, needs you"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0"
          class="chip-link"
          aria-label="Thread: Estimate the unestimated checkout stories, needs you"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"
              /></svg
            ><span class="chip-name">Estimate</span></span
          ><span class="chip-name"> the unestimated checkout stories</span
          ><span class="chip-state">Needs you</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="thread"
        data-state="working"
        title="Thread: Draft the gift card refund stories, working"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W1"
          class="chip-link"
          aria-label="Thread: Draft the gift card refund stories, working"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"
              /></svg
            ><span class="chip-name">Draft</span></span
          ><span class="chip-name"> the gift card refund stories</span
          ><span class="chip-state">Working</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="thread"
        data-state="done"
        title="Thread: Rebook passengers on cancelled sailings, done"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W2"
          class="chip-link"
          aria-label="Thread: Rebook passengers on cancelled sailings, done"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"
              /></svg
            ><span class="chip-name">Rebook</span></span
          ><span class="chip-name"> passengers on cancelled sailings</span
          ><span class="chip-state">Done</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="thread"
        data-state="handed-off"
        title="Thread: Hand the scanner bug to the crew app team, handed off"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W3"
          class="chip-link"
          aria-label="Thread: Hand the scanner bug to the crew app team, handed off"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"
              /></svg
            ><span class="chip-name">Hand</span></span
          ><span class="chip-name"> the scanner bug to the crew app team</span
          ><span class="chip-state">Handed off</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="thread"
        data-state="dropped"
        title="Thread: Try a Slack post, dropped"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W4"
          class="chip-link"
          aria-label="Thread: Try a Slack post, dropped"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"
              /></svg
            ><span class="chip-name">Try</span></span
          ><span class="chip-name"> a Slack post</span><span class="chip-state">Dropped</span></a
        ></span
      >
    </li>
  </ul>
  <p>A change set:</p>
  <ul>
    <li>
      <span
        class="chip"
        data-kind="change-set"
        data-state="pending"
        title="Change set: Estimate the unestimated checkout stories, waiting"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0?changeSet=01JBX5A1B2C3D4E5F6G7H8J9K0"
          class="chip-link"
          aria-label="Change set: Estimate the unestimated checkout stories, waiting"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2" width="11" height="12" rx="2" />
              <path d="M8 4.5v4M6 6.5h4M6 11h4" /></svg
            ><span class="chip-name">Estimate</span></span
          ><span class="chip-name"> the unestimated checkout stories</span
          ><span class="chip-state">Waiting</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="change-set"
        data-state="approved"
        title="Change set: Estimate the unestimated checkout stories, approved"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0?changeSet=01JBX5A1B2C3D4E5F6G7H8J9K0"
          class="chip-link"
          aria-label="Change set: Estimate the unestimated checkout stories, approved"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2" width="11" height="12" rx="2" />
              <path d="M8 4.5v4M6 6.5h4M6 11h4" /></svg
            ><span class="chip-name">Estimate</span></span
          ><span class="chip-name"> the unestimated checkout stories</span
          ><span class="chip-state">Approved</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="change-set"
        data-state="applied"
        title="Change set: Estimate the unestimated checkout stories, applied"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0?changeSet=01JBX5A1B2C3D4E5F6G7H8J9K0"
          class="chip-link"
          aria-label="Change set: Estimate the unestimated checkout stories, applied"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2" width="11" height="12" rx="2" />
              <path d="M8 4.5v4M6 6.5h4M6 11h4" /></svg
            ><span class="chip-name">Estimate</span></span
          ><span class="chip-name"> the unestimated checkout stories</span
          ><span class="chip-state">Applied</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="change-set"
        data-state="rejected"
        title="Change set: Estimate the unestimated checkout stories, rejected"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0?changeSet=01JBX5A1B2C3D4E5F6G7H8J9K0"
          class="chip-link"
          aria-label="Change set: Estimate the unestimated checkout stories, rejected"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2" width="11" height="12" rx="2" />
              <path d="M8 4.5v4M6 6.5h4M6 11h4" /></svg
            ><span class="chip-name">Estimate</span></span
          ><span class="chip-name"> the unestimated checkout stories</span
          ><span class="chip-state">Rejected</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="change-set"
        data-state="reverted"
        title="Change set: Estimate the unestimated checkout stories, reverted"
        ><a
          href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0?changeSet=01JBX5A1B2C3D4E5F6G7H8J9K0"
          class="chip-link"
          aria-label="Change set: Estimate the unestimated checkout stories, reverted"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2.5" y="2" width="11" height="12" rx="2" />
              <path d="M8 4.5v4M6 6.5h4M6 11h4" /></svg
            ><span class="chip-name">Estimate</span></span
          ><span class="chip-name"> the unestimated checkout stories</span
          ><span class="chip-state">Reverted</span></a
        ></span
      >
    </li>
  </ul>
  <p>A workstream:</p>
  <ul>
    <li>
      <span
        class="chip"
        data-kind="workstream"
        data-state="open"
        title="Workstream: Gift cards, open"
        ><a
          href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P0"
          class="chip-link"
          aria-label="Workstream: Gift cards, open"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg
            ><span class="chip-name">Gift</span></span
          ><span class="chip-name"> cards</span><span class="chip-state">Open</span></a
        ></span
      >
    </li>
    <li>
      <span
        class="chip"
        data-kind="workstream"
        data-state="done"
        title="Workstream: Checkout v2: phone wallets and saved cards, done"
        ><a
          href="/workstreams/01JBX3Z9Y8X7W6V5T4S3R2Q1P0"
          class="chip-link"
          aria-label="Workstream: Checkout v2: phone wallets and saved cards, done"
          ><span class="chip-lead"
            ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></svg
            ><span class="chip-name">Checkout</span></span
          ><span class="chip-name"> v2: phone wallets and saved cards</span
          ><span class="chip-state">Done</span></a
        ></span
      >
    </li>
  </ul>
</div>
```

The state colours follow decision 0034: the accent means "your move", so a thread that needs you and a change set waiting for review are in the accent; working, approved and in progress are `--in-progress`; done and applied are `--done`; handed off has its own token, `--handed-off`, which every theme derives from done (decision 0034); dropped is a hollow dot. To do, open, rejected and reverted have no rule and fall back to a `--todo` dot and `--text-faint` words (`.chip` in `window.css`).

```html specimen id=no-page title="An item with no web page (a file): a button, and no key"
<div class="reply">
  <p>
    The refund rules are in
    <span class="chip" data-kind="item" title="File: Gift card refunds: meeting notes.md"
      ><button type="button" class="chip-link item-link">
        <span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 2h5l3 3v9H4zM9 2v3h3" /></svg
          ><span class="chip-name">Gift</span></span
        ><span class="chip-name"> card refunds: meeting notes.md</span>
      </button></span
    >, not in any ticket.
  </p>
</div>
```

```html specimen id=cut title="A long name, cut at a word"
<div class="reply">
  <p>
    <span
      class="chip"
      data-kind="item"
      data-state="todo"
      title="SYN-15: Pick a font that covers Greek, Cyrillic, Arabic, Hangul and Japanese, to do"
      ><a
        class="chip-link"
        href="https://example.atlassian.net/browse/SYN-15"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-15</span></span
        >
        <span class="chip-name">Pick a font that covers Greek, Cyrillic…</span
        ><span class="chip-state">To Do</span></a
      ></span
    >
    blocks the Japanese push alerts.
  </p>
</div>
```

```html specimen id=rows-block title="In a rows block, the same component"
<ul class="block-rows">
  <li>
    <span
      class="chip"
      data-kind="item"
      data-state="in-progress"
      title="SYN-23: Pay with a phone wallet on the website, in progress"
      ><a
        class="chip-link"
        href="https://example.atlassian.net/browse/SYN-23"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-23</span></span
        >
        <span class="chip-name">Pay with a phone wallet on the website</span
        ><span class="chip-state">In Progress</span></a
      ></span
    ><span class="in-region">in this workstream</span>
  </li>
  <li>
    <span
      class="chip"
      data-kind="item"
      data-state="in-progress"
      title="SYN-21: Update the payment declined error message, in progress"
      ><a
        class="chip-link"
        href="https://example.atlassian.net/browse/SYN-21"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-21</span></span
        >
        <span class="chip-name">Update the payment declined error message</span
        ><span class="chip-state">In Progress</span></a
      ></span
    >
  </li>
  <li>
    <span
      class="chip"
      data-kind="item"
      data-state="todo"
      title="SYN-10: Remove the legacy web-view checkout, to do"
      ><a
        class="chip-link"
        href="https://example.atlassian.net/browse/SYN-10"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-10</span></span
        >
        <span class="chip-name">Remove the legacy web-view checkout</span
        ><span class="chip-state">To Do</span></a
      ></span
    ><span class="in-region">in this workstream</span>
  </li>
</ul>
```

```html specimen id=pending-unknown title="Named while the turn runs, and one Oriel can't resolve"
<div class="reply">
  <p>
    It should go in <span class="chip" data-pending="">…</span>, which already holds the refund
    stories.
    <span class="chip" data-unknown="" title="Oriel has nothing with this ID"
      >unknown reference</span
    >
    looks like a story from another project.
  </p>
</div>
```

```html specimen id=plain title="On a review link's page, nothing navigates: text, with its state in brackets"
<div class="reply">
  <p>
    Applying this moves
    <span class="chip" data-kind="item" data-plain=""
      >SYN-23 Pay with a phone wallet on the website (In Progress)</span
    >
    into
    <span class="chip" data-kind="workstream" data-plain=""
      >Checkout v2: phone wallets and saved cards (Open)</span
    >.
  </p>
</div>
```

## States

```html specimen id=state-hover title="Hover: the name's underline darkens to the text's colour" state=hover
<div class="reply">
  <p>
    <span
      class="chip"
      data-kind="item"
      data-state="in-progress"
      title="SYN-23: Pay with a phone wallet on the website, in progress"
      ><a
        class="chip-link ws-hover"
        href="https://example.atlassian.net/browse/SYN-23"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-23</span></span
        >
        <span class="chip-name">Pay with a phone wallet on the website</span
        ><span class="chip-state">In Progress</span></a
      ></span
    >
  </p>
</div>
```

```html specimen id=state-focus title="Focus visible: the global ring, around the whole chip" state=focus-visible
<div class="reply">
  <p>
    <span
      class="chip"
      data-kind="thread"
      data-state="needs-you"
      title="Thread: Estimate the unestimated checkout stories, needs you"
      ><a
        href="/threads/01JBX4K7Q2M8N3P5R6S7T8V9W0"
        class="chip-link ws-focus-visible"
        aria-label="Thread: Estimate the unestimated checkout stories, needs you"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"
            /></svg
          ><span class="chip-name">Estimate</span></span
        ><span class="chip-name"> the unestimated checkout stories</span
        ><span class="chip-state">Needs you</span></a
      ></span
    >
  </p>
</div>
```

- **Rest:** as above.
- **Hover:** the name's underline turns `currentColor` (`.chip .chip-link:hover .chip-name` in `window.css`). Nothing else changes.
- **Focus visible:** the global ring on the link (`:focus-visible` in `window.css`). A chip that wraps across two lines draws its ring in two pieces.
- **Active**, **disabled:** not styled, and a chip is never disabled.
- **Loading:** `data-pending`, "…" in `--text-faint`, while the turn that named it runs. It becomes the chip when the thread reloads as the turn ends.
- **Error:** `data-unknown`, "unknown reference" with a dashed underline and the title "Oriel has nothing with this ID". The thread's next turn gets a note naming it.
- **Plain:** `data-plain` has no rule of its own; it's text in the sentence's colour.
- **Empty** doesn't apply.

## Keyboard and ARIA

- The chip is a real link. Tab reaches it; Enter opens it. A plain click opens the item in the panel, or the thread or workstream in the window. Cmd/Ctrl, Shift or a middle click follows the `href` to the item's source, as any link does (`ItemLink` in `packages/web/src/parts.tsx`).
- A thread, change set or workstream chip has an `aria-label` with its whole label: "Thread: Estimate the unestimated checkout stories, needs you". So a screen reader hears the full name, not the cut one.
- **An item chip has no `aria-label`**, only a `title`. A screen reader hears what's visible: "SYN-23 Pay with a phone wallet on the website In Progress", and a cut name stays cut. Give a new item chip the same `aria-label` the others have if you touch `Chip`.
- The icon is `aria-hidden`. The state's dot is a pseudo-element, so it isn't read; the state's words are.
- A chip's whole label is also its `title`, for a pointer. That's a native title, not Oriel's [tooltip](/components/tooltip).

## Content

- Never write a chip's words by hand, in code or in a prompt. They come from `chipLabel`, `chipStateName` and `chipName` in `packages/web/src/chip.ts`.
- The label is "key or kind: name, state", the state lowercased: "SYN-23: Pay with a phone wallet on the website, in progress", "Change set: Estimate the unestimated checkout stories, waiting".
- An item's state is its source's own status name ("In Progress", "To Do"). A thread's is "Needs you", "Working", "Done", "Handed off" or "Dropped". A change set's is "Waiting", "Approved", "Applied", "Rejected" or "Reverted". A workstream's is "Open" or "Done".
- A change set goes by its thread's name.
- A source whose keys mean nothing to a person (a file's path, a message's timestamp) shows no key: its connector's `keysReadAs` ("File", "Message", "Row") leads the label instead.
- The agent doesn't repeat what a chip shows, and writes no possessive after one: "the description of SYN-45", not "SYN-45's description" (decision 0032).

## Where the app uses it

- `Chip` in `packages/web/src/parts.tsx`. `AnswerChip` in `packages/web/src/parts.tsx` draws the pending and unknown ones. Kind icons: `ChipIcon` in `packages/web/src/parts.tsx`.
- The words: `chipState` in `packages/web/src/chip.ts` (state), `chipStateName` in `packages/web/src/chip.ts` (state name), `chipLabel` in `packages/web/src/chip.ts` (label), `chipName` in `packages/web/src/chip.ts` (the cut).
- In an answer: `span` in `packages/web/src/parts.tsx`. In a quote's caption: `QuoteFrom` in `packages/web/src/parts.tsx`. In a rows block: `BlockBody` in `packages/web/src/block.tsx`.
- CSS: `.chip`, `.chip .chip-link`, `.chip-icon`, `.chip-lead`, `.chip-key`, `.chip-name`, `.chip-state`, `.chip-state::before`, `.chip[data-unknown]` and `.chip[data-pending]` in `window.css`, then one rule per state colour.

The chip is one component, used everywhere it shows, so its status is stable. What's left drifts with the rest of the state colours: the chip is one of five maps from a state to a colour, and the others disagree with it on "dropped" and on which waiting states are the person's move. See [Badge](/components/badge#drift) and [the drift report](/drift) (cms:A1).
