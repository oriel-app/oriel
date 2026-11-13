---
title: Noticed
status: drifting
group: Surfaces
order: 41
classes: noticed-by, noticed-cards, noticed-card, noticed-card-head, noticed-kind, noticed-rule-mark, noticed-subject, noticed-headline, noticed-why, noticed-why-by, noticed-actions, noticed-pinned, noticed-none, noticed-taught
summary: The overview's strip of what Oriel found in the window unasked (decision 0052), each card Oriel's true fact with one checked line from the agent, and Pin, Ask about this and Dismiss.
---

# Noticed

## What it is

The Noticed strip is the overview's at most four cards about what in the window may need the person, found without anyone asking (decision 0052). It sits in the overview's side column, under Not in a workstream yet, so it never pushes the workstreams down.

"A card's kind, subject, headline, rule and block are Oriel's; its one line is the agent's, checked by Oriel and captioned as the agent's; a quote is shown only once found word for word." (`packages/web/src/noticed-strip.tsx`)

- **Oriel finds.** Oriel computes **signals** from the index, the change log, the workstreams and the threads, each true by its rule: a workstream that stalled, estimates that rose, a person with a lot in progress, a chat message that names an item after it was marked done, an epic that gained items.
- **The agent picks.** One **pass** of the person's model reads the signals and the text of their items, picks up to four, and writes one line for each. It can't add a signal, a figure or a block. Oriel shows its line only if it passes Oriel's checks (one line, no link or markup, no chip outside the signal's items, no number Oriel didn't compute), and a quote only if it's found word for word.
- The pass runs after a sync or a curation, in the background, never when the overview opens. A look shows the last pass's cards whose signals still hold.

Each card offers **Pin**, **Ask about this** and **Dismiss**. A pin is a [block pinned to the overview](/components/block#pins): it's drawn in the Pinned strip, documented on the Block page.

## When to use it

- For what Oriel found that the person didn't ask about, on the overview, and only there: it's "the one place the overview shows generated words, captioned, checked, and generated after a sync, never on open" (decision 0052).
- A new kind of signal is a new card kind here, with its rule and its block, not a new strip.

## When not to

- Not for anything the person asked for. An answer is a reply in the window chat or a thread, with its [blocks](/components/block).
- Not for what needs the person's decision, such as a change set waiting: that's Needs you in the [sidebar](/components/sidebar).
- Not for the overview's own computed lines (the headlines): those have no model in them, so they have no caption saying whose words they are. See [Overview sections](/components/overview-section).
- Not with figures in the agent's line. A figure on a card is Oriel's, in the headline or the block.

## Anatomy and variants

The strip is an [overview section](/components/overview-section) (`section.overview-section`, `data-section="noticed"`), its head **Noticed** with who found it and when (`.noticed-by`, faint, `--text-xs`, in the head's line). Then the cards, in a grid at least 17rem wide each (`.noticed-cards`).

A card (`article.noticed-card`, `data-kind` its kind) is framed as a list is, by the theme's `--list-frame` and `--list-bg`, `--radius-lg`, with `--space-3` padding. In order:

1. **The head** (`.noticed-card-head`): the kind in faint small capitals (`.noticed-kind`): Stalled, Estimates rose, A lot in progress, Chat after done, Scope grew. Then ⓘ (`.noticed-rule-mark`), whose tooltip is Oriel's rule, then the subject (`.noticed-subject`, medium): a workstream as a link, an item as a [chip](/components/chip), a person by name.
2. **The headline** (`.noticed-headline`): Oriel's sentence with Oriel's figures.
3. **The agent's line** (`.noticed-why`), when it passed: on the derived tint (`--derived-soft`, a `--derived-line` rule at its left), captioned **"The agent's words, unasked"** (`.noticed-why-by`).
4. **A quote**, when found word for word: the [message](/components/message) page's `.quote-from`, "Word for word from" and the item's chip.
5. **The block**, Oriel's, at its first rows: a [block](/components/block) built from a signal's read, with its caption.
6. **The actions** (`.noticed-actions`): Pin (or **Pinned**, `.noticed-pinned`, faint, once it is), Ask about this, Dismiss, each a `.quiet-action`, and ⓘ: "It stays away until its figures move on."

Under the cards, what dismissals taught, one faint line each (`.noticed-taught`).

```html specimen id=strip title="The strip, two cards: a person with a lot in progress, and chat after done"
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">
    Noticed<span class="noticed-by">Found by Oriel's rules, picked by the agent, 2 h ago</span>
  </h2>
  <div class="noticed-cards">
    <article class="noticed-card" data-kind="overloaded">
      <header class="noticed-card-head">
        <span class="noticed-kind">A lot in progress</span
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="Oriel's rule"
          aria-describedby="tip-rule-1"
          >ⓘ</span
        ><span id="tip-rule-1" role="tooltip" popover="manual" class="tooltip"
          >Oriel rule: A person with at least 5 items in progress, twice the median or more</span
        ><span class="noticed-subject">Amara Okafor</span>
      </header>
      <p class="noticed-headline">Amara Okafor has 8 items in progress; the median person has 3</p>
      <div class="noticed-why">
        <p>
          Amara is carrying far more in-progress work than the median, and
          <span
            class="chip"
            data-kind="item"
            data-state="in-progress"
            title="SYN-51: دعم الكتابة من اليمين إلى اليسار في شاشة الحجز, in progress"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-51"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-51</span></span
              >
              <span class="chip-name">دعم الكتابة من اليمين إلى اليسار في شاشة الحجز</span
              ><span class="chip-state">In Progress</span></a
            ></span
          >
          has had no update for a week. Consider moving some of her items.
        </p>
        <p class="noticed-why-by">The agent's words, unasked</p>
      </div>
      <figure class="quote-from" data-found="true">
        <figcaption>
          Word for word from
          <span
            class="chip"
            data-kind="item"
            data-state="in-progress"
            title="SYN-51: دعم الكتابة من اليمين إلى اليسار في شاشة الحجز, in progress"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-51"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-51</span></span
              >
              <span class="chip-name">دعم الكتابة من اليمين إلى اليسار في شاشة الحجز</span
              ><span class="chip-state">In Progress</span></a
            ></span
          >
        </figcaption>
        <blockquote><p>Right-to-left layout for the booking screens.</p></blockquote>
      </figure>
      <figure class="answer-block" data-form="bars">
        <ol class="block-bars">
          <li>
            <span class="block-bar-label">Amara Okafor</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 100%"></span></span
            ><span class="block-bar-value">8</span>
          </li>
          <li>
            <span class="block-bar-label">Esme Whitlock</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 50%"></span></span
            ><span class="block-bar-value">4</span>
          </li>
          <li>
            <span class="block-bar-label">Farid Haddad</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 50%"></span></span
            ><span class="block-bar-value">4</span>
          </li>
          <li>
            <span class="block-bar-label">Bastian Holm</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 37.5%"></span></span
            ><span class="block-bar-value">3</span>
          </li>
          <li>
            <span class="block-bar-label">Chen Yuting</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 37.5%"></span></span
            ><span class="block-bar-value">3</span>
          </li>
        </ol>
        <p class="block-more">and 3 more</p>
        <figcaption>
          Computed by Oriel from the index: items in progress, by person: In progress by Person,
          highest first
        </figcaption>
      </figure>
      <footer class="noticed-actions">
        <button type="button" class="quiet-action">Pin</button
        ><button type="button" class="quiet-action">Ask about this</button
        ><button type="button" class="quiet-action">Dismiss</button
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="About Dismiss"
          aria-describedby="tip-dismiss-1"
          >ⓘ</span
        ><span id="tip-dismiss-1" role="tooltip" popover="manual" class="tooltip"
          >It stays away until its figures move on.</span
        >
      </footer>
    </article>
    <article class="noticed-card" data-kind="contradicted">
      <header class="noticed-card-head">
        <span class="noticed-kind">Chat after done</span
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="Oriel's rule"
          aria-describedby="tip-rule-2"
          >ⓘ</span
        ><span id="tip-rule-2" role="tooltip" popover="manual" class="tooltip"
          >Oriel rule: A chat message that names an item after it was marked done</span
        ><span class="noticed-subject"
          ><span
            class="chip"
            data-kind="item"
            data-state="done"
            title="SYN-47: Show the disruption reason in plain words, done"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-47"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-47</span></span
              >
              <span class="chip-name">Show the disruption reason in plain words</span
              ><span class="chip-state">Done</span></a
            ></span
          ></span
        >
      </header>
      <p class="noticed-headline">1 chat message named SYN-47 after it was marked done</p>
      <div class="noticed-why">
        <p>
          <span
            class="chip"
            data-kind="item"
            data-state="done"
            title="SYN-47: Show the disruption reason in plain words, done"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-47"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-47</span></span
              >
              <span class="chip-name">Show the disruption reason in plain words</span
              ><span class="chip-state">Done</span></a
            ></span
          >
          is marked done, but Chen says the copy is still with ops. The replies conflict, so confirm
          the real status.
        </p>
        <p class="noticed-why-by">The agent's words, unasked</p>
      </div>
      <figure class="quote-from" data-found="true">
        <figcaption>
          Word for word from
          <span
            class="chip"
            data-kind="item"
            title="Message: Status of SYN-47 (the disruption reason in plain words)?"
            ><a
              class="chip-link"
              href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1790071200000100"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                ><span class="chip-name">Status</span></span
              ><span class="chip-name"> of SYN-47 (the disruption reason in plain words)?</span></a
            ></span
          >
        </figcaption>
        <blockquote><p>Not done: copy is still with ops.</p></blockquote>
      </figure>
      <figure class="answer-block" data-form="rows">
        <ul class="block-rows">
          <li>
            <span
              class="chip"
              data-kind="item"
              title="Message: Status of SYN-47 (the disruption reason in plain words)?"
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1790071200000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Status</span></span
                ><span class="chip-name">
                  of SYN-47 (the disruption reason in plain words)?</span
                ></a
              ></span
            >
          </li>
        </ul>
        <figcaption>
          Computed by Oriel from the index: chat messages naming an item after it was done
        </figcaption>
      </figure>
      <footer class="noticed-actions">
        <button type="button" class="quiet-action">Pin</button
        ><button type="button" class="quiet-action">Ask about this</button
        ><button type="button" class="quiet-action">Dismiss</button
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="About Dismiss"
          aria-describedby="tip-dismiss-2"
          >ⓘ</span
        ><span id="tip-dismiss-2" role="tooltip" popover="manual" class="tooltip"
          >It stays away until its figures move on.</span
        >
      </footer>
    </article>
  </div>
</section>
```

```html specimen id=headline-only title="A card whose line failed Oriel's checks: Oriel's headline alone"
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">
    Noticed<span class="noticed-by">Found by Oriel's rules, picked by the agent, 2 h ago</span>
  </h2>
  <div class="noticed-cards">
    <article class="noticed-card" data-kind="overloaded">
      <header class="noticed-card-head">
        <span class="noticed-kind">A lot in progress</span
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="Oriel's rule"
          aria-describedby="tip-rule-3"
          >ⓘ</span
        ><span id="tip-rule-3" role="tooltip" popover="manual" class="tooltip"
          >Oriel rule: A person with at least 5 items in progress, twice the median or more</span
        ><span class="noticed-subject">Amara Okafor</span>
      </header>
      <p class="noticed-headline">Amara Okafor has 8 items in progress; the median person has 3</p>
      <figure class="answer-block" data-form="bars">
        <ol class="block-bars">
          <li>
            <span class="block-bar-label">Amara Okafor</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 100%"></span></span
            ><span class="block-bar-value">8</span>
          </li>
          <li>
            <span class="block-bar-label">Esme Whitlock</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 50%"></span></span
            ><span class="block-bar-value">4</span>
          </li>
          <li>
            <span class="block-bar-label">Farid Haddad</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 50%"></span></span
            ><span class="block-bar-value">4</span>
          </li>
          <li>
            <span class="block-bar-label">Bastian Holm</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 37.5%"></span></span
            ><span class="block-bar-value">3</span>
          </li>
          <li>
            <span class="block-bar-label">Chen Yuting</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 37.5%"></span></span
            ><span class="block-bar-value">3</span>
          </li>
        </ol>
        <p class="block-more">and 3 more</p>
        <figcaption>
          Computed by Oriel from the index: items in progress, by person: In progress by Person,
          highest first
        </figcaption>
      </figure>
      <footer class="noticed-actions">
        <button type="button" class="quiet-action">Pin</button
        ><button type="button" class="quiet-action">Ask about this</button
        ><button type="button" class="quiet-action">Dismiss</button
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="About Dismiss"
          aria-describedby="tip-dismiss-3"
          >ⓘ</span
        ><span id="tip-dismiss-3" role="tooltip" popover="manual" class="tooltip"
          >It stays away until its figures move on.</span
        >
      </footer>
    </article>
  </div>
</section>
```

```html specimen id=pinned-taught title="Pinned, and what dismissals taught"
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">
    Noticed<span class="noticed-by">Found by Oriel's rules, picked by the agent, 2 h ago</span>
  </h2>
  <div class="noticed-cards">
    <article class="noticed-card" data-kind="contradicted">
      <header class="noticed-card-head">
        <span class="noticed-kind">Chat after done</span
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="Oriel's rule"
          aria-describedby="tip-rule-4"
          >ⓘ</span
        ><span id="tip-rule-4" role="tooltip" popover="manual" class="tooltip"
          >Oriel rule: A chat message that names an item after it was marked done</span
        ><span class="noticed-subject"
          ><span
            class="chip"
            data-kind="item"
            data-state="done"
            title="SYN-47: Show the disruption reason in plain words, done"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-47"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-47</span></span
              >
              <span class="chip-name">Show the disruption reason in plain words</span
              ><span class="chip-state">Done</span></a
            ></span
          ></span
        >
      </header>
      <p class="noticed-headline">1 chat message named SYN-47 after it was marked done</p>
      <div class="noticed-why">
        <p>
          <span
            class="chip"
            data-kind="item"
            data-state="done"
            title="SYN-47: Show the disruption reason in plain words, done"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-47"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-47</span></span
              >
              <span class="chip-name">Show the disruption reason in plain words</span
              ><span class="chip-state">Done</span></a
            ></span
          >
          is marked done, but Chen says the copy is still with ops. The replies conflict, so confirm
          the real status.
        </p>
        <p class="noticed-why-by">The agent's words, unasked</p>
      </div>
      <figure class="quote-from" data-found="true">
        <figcaption>
          Word for word from
          <span
            class="chip"
            data-kind="item"
            title="Message: Status of SYN-47 (the disruption reason in plain words)?"
            ><a
              class="chip-link"
              href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1790071200000100"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                ><span class="chip-name">Status</span></span
              ><span class="chip-name"> of SYN-47 (the disruption reason in plain words)?</span></a
            ></span
          >
        </figcaption>
        <blockquote><p>Not done: copy is still with ops.</p></blockquote>
      </figure>
      <figure class="answer-block" data-form="rows">
        <ul class="block-rows">
          <li>
            <span
              class="chip"
              data-kind="item"
              title="Message: Status of SYN-47 (the disruption reason in plain words)?"
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1790071200000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Status</span></span
                ><span class="chip-name">
                  of SYN-47 (the disruption reason in plain words)?</span
                ></a
              ></span
            >
          </li>
        </ul>
        <figcaption>
          Computed by Oriel from the index: chat messages naming an item after it was done
        </figcaption>
      </figure>
      <footer class="noticed-actions">
        <span class="noticed-pinned">Pinned</span
        ><button type="button" class="quiet-action">Ask about this</button
        ><button type="button" class="quiet-action">Dismiss</button
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="About Dismiss"
          aria-describedby="tip-dismiss-4"
          >ⓘ</span
        ><span id="tip-dismiss-4" role="tooltip" popover="manual" class="tooltip"
          >It stays away until its figures move on.</span
        >
      </footer>
    </article>
  </div>
  <p class="noticed-taught">Shown less: people with a lot in progress, after 3 dismissals</p>
</section>
```

## States

```html specimen id=state-running title="A pass running: the last pass's cards that still hold" state=busy
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">Noticed<span class="noticed-by">Looking at what changed…</span></h2>
  <div class="noticed-cards">
    <article class="noticed-card" data-kind="contradicted">
      <header class="noticed-card-head">
        <span class="noticed-kind">Chat after done</span
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="Oriel's rule"
          aria-describedby="tip-rule-5"
          >ⓘ</span
        ><span id="tip-rule-5" role="tooltip" popover="manual" class="tooltip"
          >Oriel rule: A chat message that names an item after it was marked done</span
        ><span class="noticed-subject"
          ><span
            class="chip"
            data-kind="item"
            data-state="done"
            title="SYN-47: Show the disruption reason in plain words, done"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-47"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-47</span></span
              >
              <span class="chip-name">Show the disruption reason in plain words</span
              ><span class="chip-state">Done</span></a
            ></span
          ></span
        >
      </header>
      <p class="noticed-headline">1 chat message named SYN-47 after it was marked done</p>
      <div class="noticed-why">
        <p>
          <span
            class="chip"
            data-kind="item"
            data-state="done"
            title="SYN-47: Show the disruption reason in plain words, done"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-47"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-47</span></span
              >
              <span class="chip-name">Show the disruption reason in plain words</span
              ><span class="chip-state">Done</span></a
            ></span
          >
          is marked done, but Chen says the copy is still with ops. The replies conflict, so confirm
          the real status.
        </p>
        <p class="noticed-why-by">The agent's words, unasked</p>
      </div>
      <figure class="quote-from" data-found="true">
        <figcaption>
          Word for word from
          <span
            class="chip"
            data-kind="item"
            title="Message: Status of SYN-47 (the disruption reason in plain words)?"
            ><a
              class="chip-link"
              href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1790071200000100"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                ><span class="chip-name">Status</span></span
              ><span class="chip-name"> of SYN-47 (the disruption reason in plain words)?</span></a
            ></span
          >
        </figcaption>
        <blockquote><p>Not done: copy is still with ops.</p></blockquote>
      </figure>
      <figure class="answer-block" data-form="rows">
        <ul class="block-rows">
          <li>
            <span
              class="chip"
              data-kind="item"
              title="Message: Status of SYN-47 (the disruption reason in plain words)?"
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1790071200000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Status</span></span
                ><span class="chip-name">
                  of SYN-47 (the disruption reason in plain words)?</span
                ></a
              ></span
            >
          </li>
        </ul>
        <figcaption>
          Computed by Oriel from the index: chat messages naming an item after it was done
        </figcaption>
      </figure>
      <footer class="noticed-actions">
        <button type="button" class="quiet-action">Pin</button
        ><button type="button" class="quiet-action">Ask about this</button
        ><button type="button" class="quiet-action">Dismiss</button
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="About Dismiss"
          aria-describedby="tip-dismiss-5"
          >ⓘ</span
        ><span id="tip-dismiss-5" role="tooltip" popover="manual" class="tooltip"
          >It stays away until its figures move on.</span
        >
      </footer>
    </article>
  </div>
</section>
```

```html specimen id=state-busy title="Pinning or dismissing: Pin and Dismiss wait" state=disabled
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">
    Noticed<span class="noticed-by">Found by Oriel's rules, picked by the agent, 2 h ago</span>
  </h2>
  <div class="noticed-cards">
    <article class="noticed-card" data-kind="overloaded">
      <header class="noticed-card-head">
        <span class="noticed-kind">A lot in progress</span
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="Oriel's rule"
          aria-describedby="tip-rule-6"
          >ⓘ</span
        ><span id="tip-rule-6" role="tooltip" popover="manual" class="tooltip"
          >Oriel rule: A person with at least 5 items in progress, twice the median or more</span
        ><span class="noticed-subject">Amara Okafor</span>
      </header>
      <p class="noticed-headline">Amara Okafor has 8 items in progress; the median person has 3</p>
      <div class="noticed-why">
        <p>
          Amara is carrying far more in-progress work than the median, and
          <span
            class="chip"
            data-kind="item"
            data-state="in-progress"
            title="SYN-51: دعم الكتابة من اليمين إلى اليسار في شاشة الحجز, in progress"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-51"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-51</span></span
              >
              <span class="chip-name">دعم الكتابة من اليمين إلى اليسار في شاشة الحجز</span
              ><span class="chip-state">In Progress</span></a
            ></span
          >
          has had no update for a week. Consider moving some of her items.
        </p>
        <p class="noticed-why-by">The agent's words, unasked</p>
      </div>
      <figure class="quote-from" data-found="true">
        <figcaption>
          Word for word from
          <span
            class="chip"
            data-kind="item"
            data-state="in-progress"
            title="SYN-51: دعم الكتابة من اليمين إلى اليسار في شاشة الحجز, in progress"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-51"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-51</span></span
              >
              <span class="chip-name">دعم الكتابة من اليمين إلى اليسار في شاشة الحجز</span
              ><span class="chip-state">In Progress</span></a
            ></span
          >
        </figcaption>
        <blockquote><p>Right-to-left layout for the booking screens.</p></blockquote>
      </figure>
      <figure class="answer-block" data-form="bars">
        <ol class="block-bars">
          <li>
            <span class="block-bar-label">Amara Okafor</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 100%"></span></span
            ><span class="block-bar-value">8</span>
          </li>
          <li>
            <span class="block-bar-label">Esme Whitlock</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 50%"></span></span
            ><span class="block-bar-value">4</span>
          </li>
          <li>
            <span class="block-bar-label">Farid Haddad</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 50%"></span></span
            ><span class="block-bar-value">4</span>
          </li>
          <li>
            <span class="block-bar-label">Bastian Holm</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 37.5%"></span></span
            ><span class="block-bar-value">3</span>
          </li>
          <li>
            <span class="block-bar-label">Chen Yuting</span
            ><span class="block-bar-track" aria-hidden="true"
              ><span class="block-bar" style="width: 37.5%"></span></span
            ><span class="block-bar-value">3</span>
          </li>
        </ol>
        <p class="block-more">and 3 more</p>
        <figcaption>
          Computed by Oriel from the index: items in progress, by person: In progress by Person,
          highest first
        </figcaption>
      </figure>
      <footer class="noticed-actions">
        <button type="button" class="quiet-action" disabled>Pin</button
        ><button type="button" class="quiet-action">Ask about this</button
        ><button type="button" class="quiet-action" disabled>Dismiss</button
        ><span
          class="noticed-rule-mark"
          tabindex="0"
          aria-label="About Dismiss"
          aria-describedby="tip-dismiss-6"
          >ⓘ</span
        ><span id="tip-dismiss-6" role="tooltip" popover="manual" class="tooltip"
          >It stays away until its figures move on.</span
        >
      </footer>
    </article>
  </div>
</section>
```

```html specimen id=state-none title="Empty: a pass ran and picked none"
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">
    Noticed<span class="noticed-by">Found by Oriel's rules, picked by the agent, 2 h ago</span>
  </h2>
  <p class="noticed-none">Nothing Oriel found needs you now.</p>
  <div class="noticed-cards"></div>
</section>
```

```html specimen id=state-error title="Error: the pass failed" state=error
<section class="overview-section" data-section="noticed" aria-label="Noticed">
  <h2 class="overview-head">
    Noticed<span class="noticed-by">Found by Oriel's rules, picked by the agent, yesterday</span>
  </h2>
  <p class="overview-problem" role="alert">Oriel couldn't look for what to notice just now.</p>
  <div class="noticed-cards"></div>
</section>
```

```html specimen id=state-focus title="Focus visible: the rule mark, then Pin" state=focus-visible
<article class="noticed-card" data-kind="overloaded">
  <header class="noticed-card-head">
    <span class="noticed-kind">A lot in progress</span
    ><span class="noticed-rule-mark ws-focus-visible" tabindex="0" aria-label="Oriel's rule">ⓘ</span
    ><span class="noticed-subject">Amara Okafor</span>
  </header>
  <p class="noticed-headline">Amara Okafor has 8 items in progress; the median person has 3</p>
  <footer class="noticed-actions">
    <button type="button" class="quiet-action ws-focus-visible">Pin</button
    ><button type="button" class="quiet-action ws-hover">Ask about this</button
    ><button type="button" class="quiet-action">Dismiss</button>
  </footer>
</article>
```

- **Hidden:** with no model ("no-ai"), before any pass has run, and when Oriel found nothing to look at ("quiet"), the strip isn't drawn at all.
- **Running:** "Looking at what changed…" in the head, and the last pass's cards that still hold, with their figures as they are now.
- **Rest:** the cards, and "Found by Oriel's rules, picked by the agent, 2 h ago".
- **Empty:** a pass ran and picked none: "Nothing Oriel found needs you now."
- **Busy:** while a pin or dismissal is under way, every card's Pin and Dismiss are disabled (`.quiet-action`'s disabled look). Ask about this isn't.
- **Error:** a failed pass, or a failed pin or dismissal, is one `.overview-problem` line under the head, `role="alert"`. The cards still showing stay.
- **Hover and focus:** a `.quiet-action`'s, and the global ring on ⓘ. The tooltips show on hover and on focus.

## Keyboard and ARIA

- The strip is a `section` named "Noticed"; its head is an `h2`, like every overview section. Each card is an `article`.
- Both ⓘ marks are tab stops (`tabindex="0"`), named "Oriel's rule" and "About Dismiss", described by their [tooltips](/components/tooltip). So Tab reaches the rule before the subject, and the reason Dismiss is safe right after it.
- The subject is a link or a chip, a tab stop of its own; a person's name isn't.
- Ask about this opens the window chat with fixed words and the subject's ID, never a name or a title: "Oriel noticed that the workstream 01M… stalled. What's behind it, and what should I do?" (`askAbout` in `packages/web/src/overview.ts`).

## Content

- Kinds are Oriel's, short: "Stalled", "Estimates rose", "A lot in progress", "Chat after done", "Scope grew" (`kindLabels` in `packages/web/src/noticed-strip.tsx`).
- The headline is Oriel's, with its figures: "Amara Okafor has 8 items in progress; the median person has 3"; "1 chat message named SYN-47 after it was marked done".
- The rule is Oriel's, prefixed "Oriel rule: ", in its tooltip (`signalRules` in `packages/server/src/signals.ts`).
- The agent's line is captioned "The agent's words, unasked", every time.
- "Shown less: stalled workstreams, after 3 dismissals": what dismissals taught, in Oriel's words, never the model's.
- The head says who found it: "Found by Oriel's rules, picked by the agent, {when}".

## Where the app uses it

- `NoticedStrip` in `packages/web/src/noticed-strip.tsx`, on the overview under Not in a workstream yet (`OverviewPage` in `packages/web/src/overview-page.tsx`). Its block at the first rows: `topOf` there.
- The signals and their blocks: `signalsOf` and `signalRules` in `packages/server/src/signals.ts`. The pass, what it keeps and what dismissals teach: `packages/server/src/noticed.ts`.
- CSS: `.noticed-by`, `.noticed-cards`, `.noticed-card`, `.noticed-why`, `.noticed-actions` and `.noticed-pinned` in `window.css`.
- Pins: `PinnedStrip`, in the same file; see [Block › Pins](/components/block#pins).

## Drift

Status **drifting**:

- **The rule mark is a character.** ⓘ is a text glyph in a focusable `span`, where every other icon is an SVG from the [icon set](/foundations/icons), and a control that only shows a tooltip is elsewhere a button. Its look on focus is the global ring around a glyph.
- **Two quiet greys.** `.noticed-none` and `.noticed-taught` are `--text-faint`, the overview's own empty lines `--text-muted` (see [Overview](/screens/overview#notes-for-review)).
- **Unstyled hooks.** The markup carries `class="noticed"` and, on the Pinned strip, `class="pinned"`, with no rule in window.css; the specimens leave them off.
- **Pinned isn't a button.** Once a card is pinned, Pin becomes faint text with the same padding, so there's no Unpin on the card; Unpin is in the Pinned strip.

Copy `NoticedStrip` as it is. A new kind is a signal in core with its rule, its read and its block, and a word in `kindLabels`.
