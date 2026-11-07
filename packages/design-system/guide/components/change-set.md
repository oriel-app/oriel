---
title: Change set
status: drifting
group: Thread
order: 70
classes: change-set, change-set-head, change-set-status, change-set-writes, change-set-count, change-set-actions, change-set-foot, change-set-problem, loading, change-set-loading, apply-errors, apply-stuck, may-have-landed, read-only-note, review-link, link-field, diff, diff-line, brought, line-head, line-mark, sentence, key, source-link, new-title, new-description, item-value, new-mark, fields, field, edited, side, side-sign, side-text, fold, arrow, remove-line, tooltip, line-error, visually-hidden, review, review-head, mark, review-card, review-writes, page-title, review-decide, review-answer, choices, choice, name-field, name-field-help, reason, review-actions, outcome, outcome-stops, stop-reason
summary: A write to a source, waiting on a person: its diff, line by line, and the steps it offers. Approve and apply, Reject, Share review link; then applying, applied, stalled, rejected or reverted. And the review link's page.
---

# Change set

## What it is

The agent never writes to a source. When it wants to change Jira (estimate a story, rewrite a description, make a story, delete one), Oriel captures the writes as a **change set** and shows it in the thread as a diff, under the reply that proposed it. Nothing is written until a person approves it: "No approve, no write, ever" (SPEC §1, idea 2). This card is that moment, so it's Oriel's most important component.

A change set card is:

1. **A head:** "Proposed change" (or "Undo", for a revert), and its status, which is a live region: "Awaiting review", "Applying…", "Applied".
2. **The diff:** one line per change. An edit shows each field's old and new text, with only the changed words marked. A new item is a card. A delete shows every field it empties.
3. **The steps:** exactly what the change set engine offers now, in its order, never one the page invents. Approve and apply is the one primary action.

The same diff, without the steps the thread keeps, is the body of the [review link's page](#the-review-link-page), for someone outside Oriel. How the whole moment works, step by step, is the [Approval](/patterns/approval) pattern.

## When to use it

- For every write to a source, whoever asked for it: the agent in a thread, or a revert of an applied change set.
- Show it as its own entry in the [chat](/components/message), after the reply that proposed it, so the reply can say what it is and the card can say exactly what changes.
- Draw only the steps the engine offers (`nextSteps`). The page labels them (`stepLabel` in `packages/web/src/thread.ts`); it never decides which exist.

## When not to

- Not for Oriel's own data. Adding items to a workstream, making one, marking a thread done: the agent does those directly, Oriel lists them under its reply with Undo (decision 0024). See [Thread messages](/components/message#oriel-s-own-lines).
- Not for a draft. A connection's options the agent drafted are the person's own action, applied, never approved, and never through a review link (decision 0051). See [Thread messages](/components/message#a-draft).
- Not for a held message. Someone else's words are sent on, not approved.
- Not a summary. The card shows every change, field by field, as it will be written. If a reply wants to summarise, it does so above the card.

## Anatomy and variants

The card is `section.change-set`: `--border-thin` in `--line-strong`, `--radius-lg`, on `--surface`, clipped with `overflow: clip` so its actions can stick inside it. Awaiting review, it's the person's move, and wears the accent on its start edge (`.change-set[data-awaits]` in `window.css`). The head is a row with the title (`--text-md`, strong), what Approve writes, and the status (faint, small) right, over a bottom rule. The footer, `.change-set-actions`, wraps its buttons on `--surface-sunk` over a top rule, and under it, while it awaits review, one line says nothing is written until the person approves.

```html specimen id=anatomy title="Awaiting review: edits, a new story, a delete" bg=bg
<section class="change-set" data-status="open" data-awaits aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-writes">4 changes in Jira · 2 edits, 1 new story, 1 deletion</span>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Change the estimate of
          <span
            class="chip"
            data-kind="item"
            data-state="to-do"
            title="SYN-99: Save a card for next time, to do"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-99"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-99</span></span
              >
              <span class="chip-name">Save a card for next time</span
              ><span class="chip-state">To Do</span></a
            ></span
          >
          from 2 points to 3 points.</span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="before">
              <span class="side-sign" aria-hidden="true">−</span
              ><span class="side-text"><span class="visually-hidden">Before: </span>2 points</span>
            </div>
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
      <button type="button" class="remove-line" aria-label="Leave this change out">×</button
      ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
        >Leave this change out</span
      >
    </li>
    <li class="diff-line ws-hover" data-kind="update">
      <p class="brought">The agent put SYN-23 in this workstream.</p>
      <p class="line-head">
        <span class="sentence"
          >Rewrite the description of
          <span
            class="chip"
            data-kind="item"
            data-state="in-progress"
            title="SYN-23: Pay with a phone wallet on the website, in progress"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-23"
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
          >.</span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Description</dt>
          <dd class="edited">
            <div class="side" data-side="same">
              <span class="side-sign" aria-hidden="true"></span
              ><span class="side-text">As a shopper on the website,</span>
            </div>
            <!-- prettier-ignore -->
            <div class="side" data-side="before"><span class="side-sign" aria-hidden="true">−</span><span class="side-text"><span class="visually-hidden">Before: </span>I want to pay with <del>my saved card</del> in one tap.</span></div>
            <!-- prettier-ignore -->
            <div class="side" data-side="after"><span class="side-sign" aria-hidden="true">+</span><span class="side-text"><span class="visually-hidden">After: </span>I want to pay with <ins>a phone wallet</ins> in one tap.</span></div>
            <div class="side" data-side="same">
              <span class="side-sign" aria-hidden="true"></span
              ><span class="side-text">The button shows only where a wallet is set up.</span>
            </div>
            <details class="fold">
              <summary>4 unchanged lines</summary>
              <!-- prettier-ignore -->
              <div class="side" data-side="same"><span class="side-sign" aria-hidden="true"></span><span class="side-text">Done when:
- It works in the main browsers.
- A declined payment says why.
- The receipt names the wallet.</span></div>
            </details>
          </dd>
        </div>
      </dl>
      <button type="button" class="remove-line" aria-label="Leave this change out">×</button
      ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
        >Leave this change out</span
      >
    </li>
    <li class="diff-line" data-kind="create">
      <p class="line-head">
        <span class="line-mark" data-kind="create">New story</span
        ><span class="new-title">Pay with a gift card</span>
      </p>
      <!-- prettier-ignore -->
      <p class="new-description">Enter the code from the card. A balance that doesn't cover the fare is topped up with another way to pay.</p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd>3 points</dd>
        </div>
        <div class="field">
          <dt>Epic</dt>
          <dd>
            <span class="item-value"
              >Checkout v2: phone wallets and saved cards<a
                class="key source-link"
                href="https://synthetic.atlassian.net/browse/SYN-1"
                target="_blank"
                rel="noopener noreferrer"
                >SYN-1</a
              ></span
            >
          </dd>
        </div>
      </dl>
      <button type="button" class="remove-line" aria-label="Leave this change out">×</button
      ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
        >Leave this change out</span
      >
    </li>
    <li class="diff-line" data-kind="delete">
      <p class="line-head">
        <span class="line-mark" data-kind="delete">Delete</span
        ><span class="sentence"
          >Delete
          <span
            class="chip"
            data-kind="item"
            data-state="to-do"
            title="SYN-901: Show the gift card balance at checkout, to do"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-901"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-901</span></span
              >
              <span class="chip-name">Show the gift card balance at checkout</span
              ><span class="chip-state">To Do</span></a
            ></span
          >
          from Jira.</span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Title</dt>
          <dd>
            <del>Show the gift card balance at checkout</del
            ><span class="arrow" aria-hidden="true">→</span><ins>—</ins>
          </dd>
        </div>
        <div class="field">
          <dt>Estimate</dt>
          <dd><del>1 point</del><span class="arrow" aria-hidden="true">→</span><ins>—</ins></dd>
        </div>
      </dl>
      <button type="button" class="remove-line" aria-label="Leave this change out">×</button
      ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
        >Leave this change out</span
      >
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary">Approve and apply</button>
    <button type="button" class="button">Reject</button>
    <button type="button" class="quiet-action">Share review link</button>
  </footer>
  <p class="change-set-foot">Nothing is written to Jira until you approve.</p>
</section>
```

The second line is shown hovered, so its × (**Leave this change out**) shows; the others reveal theirs on hover or focus.

### The head

- **Title:** "Proposed change"; "Undo" when the set reverts another (`set.revertOf`).
- **Status** (`.change-set-status`, `role="status"`): one of "Awaiting review", "Ready to apply", "Applying…", "Applied", "Partly applied", "Stopped", "Rejected"; "Apply stalled" while its source doesn't answer. A decision made on a review link adds " by {name} via review link"; a set whose Undo applied adds ", then undone".
- **What Approve writes** (`.change-set-writes`): only while it awaits review, counted from the diff's own lines, and naming each source the set writes to from its lines, never a fixed name: "5 changes in Jira · 3 edits, 2 new stories"; one kind says it once: "2 new stories in Jira" (`writes` in `packages/web/src/change-set.ts`).
- **Count** (`.change-set-count`): only on a folded set: "3 changes · 2 h ago", the time of its decision in the time format Settings picks, as a `<time>`.
- **Show / Hide**: only on a set that can fold (`foldable` in `packages/web/src/thread.ts`), a `.quiet-action` with `aria-expanded`, described by the title, status and count. It covers the whole head (`.change-set-head > .quiet-action::after` in `window.css`), so a click anywhere on the head presses it.
- **Folding by itself:** a set applied before the page opened is folded already. One whose apply ends on screen, applied in full, shows "Applied" for a beat (`landMs`, 1.2s), closes to its head at move speed (`data-closing`; instant under reduced motion) and folds. If focus was inside it, or dropped as its Approve went, it moves to Show, and the status adds, for screen readers only, ", folded. Show it to see it or revert it." It stays shown if it applied with errors, partly, or stalled; if the person showed or hid it by hand; or if the thread's address names it. An Undo folds the same way once it applies, and so does the set it reverts.

### A line

Each change is an `li.diff-line`, `data-kind` its kind, padded on the right to leave room for its ×. Lines are split by a 60% `--line` rule.

- **An edit:** `p.line-head` holds the change's sentence, as the source's catalogue words it, naming its item once, by its [chip](/components/chip): where the sentence named the item, by its title and key or its key alone, the chip stands in that place; where it didn't, the chip follows the sentence (`namedOnce` in `packages/web/src/change-set.ts`). The chip says where the item stands when the thread has it. Under it, `dl.fields`: each field's name (`dt`, faint, 5.5rem wide) and `dd.edited`, the field's text as rows.
  - `.side[data-side="before"]` has a "−" sign and a 7% `--danger` tint; `[data-side="after"]` a "+" and a 9% `--ins` tint; `[data-side="same"]` is muted, with no sign.
  - Inside a changed row, only the changed words are marked: `<del>` (a 20% danger fill, struck through) and `<ins>` (a 26% `--ins` fill). When a side shares less than 40% of its words with the other, it reads as a rewrite: plain text, no marks.
  - Unchanged lines keep one line of context on each side of a change; the rest fold into `<details class="fold">`, "4 unchanged lines".
  - A field whose value is an item shows its title and key (`.item-value`), or **new** (`.new-mark`) when a line above makes it.
  - An empty field that stays empty reads "—".
- **A new item** (`data-kind="create"`): `.line-mark[data-kind="create"]`, an `--ins` pill, "New story" ("New" if the source names no kind), then its title, strong (`.new-title`). Its description under it (`.new-description`), then its other fields. One with no title of its own, such as a message, leads with the sentence and shows its words in full as a quote (`.new-description[data-body]`).
- **A delete** (`data-kind="delete"`): a `--danger` pill, "Delete", then the sentence. Each field it empties: the old value struck through (`del`), an arrow, and "—".
- **Who brought it** (`.brought`): when the agent or an outside tool put a named item in the workstream, a muted line says so, so an approver who doesn't know the workstream can tell: "The agent put SYN-23 in this workstream." / "An outside tool put SYN-41 in this workstream."
- **Leave this change out** (`.remove-line`): a × at the line's top right, with a [tooltip](/components/tooltip) of the same words, on every line the engine says can be left out. Hidden until the line is hovered or the × is focused; 60% on a touch screen; danger-tinted on hover.

```html specimen id=new-message title="A new message: no title, its words as a quote"
<section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="create">
      <p class="line-head">
        <span class="line-mark" data-kind="create">New message</span
        ><span class="sentence">Reply in #checkout-launch</span>
      </p>
      <!-- prettier-ignore -->
      <p class="new-description" data-body="">Phone wallets are live on the website. Saved cards follow next week.</p>
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary">Approve and apply</button>
    <button type="button" class="button">Reject</button>
    <button type="button" class="quiet-action">Share review link</button>
  </footer>
</section>
```

### The steps

| Step         | Label                                                         | Class                           |
| ------------ | ------------------------------------------------------------- | ------------------------------- |
| approve      | **Approve and apply**                                         | `.button.primary`               |
| approve-rest | **Approve the rest**                                          | `.button.primary`               |
| retry        | **Try again** (after errors), else **Apply**                  | `.button.primary`               |
| reject       | **Reject**                                                    | `.button`                       |
| dismiss      | **Dismiss**                                                   | `.quiet-action`                 |
| revert       | **Revert what was applied** (partly applied), else **Revert** | `.button`                       |
| remove       | drawn per line: × or **Remove this change**                   | `.remove-line`, `.quiet-action` |

Between the forward steps and Reject, while nobody has decided, **Second look** (`.button`), or **Looking…** and **Look again**: the person's ask for the agent's reading of what else the change could affect. Its card sits between the diff and the steps. While it shows, the steps are only its own: Look again, **Add its suggestions** and **Dismiss**, which gives Approve and Reject back (OA-257). See [Second look](/components/second-look).

Then, after the steps:

- **Share review link** (`.quiet-action`), while the set can be approved. Clicked, it becomes the link in a read-only field (`.link-field`, mono, `aria-label="Review link"`) with **Copy**.
- **The read-only note** (`.read-only-note`), when the set is open but the connection can't write: "Live writes aren't configured here, so this can be reviewed and rejected, not approved."
- **Nothing is written** (`.change-set-foot`), under the steps while the set awaits review and can be approved: "Nothing is written to Jira until you approve.", naming the set's own sources. Not while a second look shows, when Approve isn't offered.

**The steps stay in reach.** While any of a change set awaiting review is on screen, its footer sticks above the composer (`position: sticky`, `bottom` from the dock's `--dock-cover`), so Approve and apply is never a scroll to the card's foot; in the window chat, it sticks to the foot of the chat's list. It stays in the card in the markup, so the keyboard reaches it in the card's order. While it's stuck it carries `[data-stuck]`, a stronger rule and `--shadow`; IntersectionObservers decide that, never the page's scroll (`watchStuck` in `packages/web/src/change-set.ts`). A thread head's state chip, **Needs review ↓**, goes to the nearest one.

```html specimen id=link-shared title="The review link, made"
<section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-23"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-23</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary">Approve and apply</button>
    <button type="button" class="button">Reject</button>
    <span class="review-link"
      ><input
        class="link-field"
        readonly
        value="http://127.0.0.1:4310/review/q7Hk2mVb9xTzR4pL"
        aria-label="Review link"
      /><button type="button" class="quiet-action">Copy</button></span
    >
  </footer>
</section>
```

```html specimen id=read-only title="Read-only: it can be reviewed and rejected, not approved"
<section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-23"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-23</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button">Reject</button>
    <span class="read-only-note"
      >Live writes aren't configured here, so this can be reviewed and rejected, not approved.</span
    >
  </footer>
</section>
```

## States

Every state the card goes through, in the order a change set lives them. The status words are the app's; so is what each state offers.

```html specimen id=state-loading title="Before the diff: reading its source, with no steps yet" state=loading
<section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <p class="loading change-set-loading" role="status">
    <span class="spinner" aria-hidden="true"></span>Reading what each change would replace in its
    source…
  </p>
</section>
```

```html specimen id=state-focus title="Focus: the primary step, and a line's ×" state=focus-visible
<section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Save a card for next time” (SYN-99) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-99"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-99</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
      <button type="button" class="remove-line ws-focus-visible" aria-label="Leave this change out">
        ×</button
      ><span role="tooltip" popover="manual" class="tooltip" aria-hidden="true"
        >Leave this change out</span
      >
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary ws-focus-visible">Approve and apply</button>
    <button type="button" class="button">Reject</button>
    <button type="button" class="quiet-action">Share review link</button>
  </footer>
</section>
```

```html specimen id=state-applying title="Applying: dimmed to .7, no steps, the status says so" state=busy
<section class="change-set" data-status="applying" aria-busy="true" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Applying…</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-23"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-23</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
    </li>
  </ul>
  <footer class="change-set-actions"></footer>
</section>
```

```html specimen id=state-applied title="Applied: each line ticked, Revert offered" state=done
<section class="change-set" data-status="applied" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Applied</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="create" data-applied="">
      <p class="line-head">
        <span class="line-mark" data-kind="create">New story</span
        ><span class="new-title">Pay with a gift card</span>
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd>3 points</dd>
        </div>
      </dl>
    </li>
    <li class="diff-line" data-kind="update" data-applied="">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-23"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-23</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button">Revert</button>
  </footer>
</section>
```

```html specimen id=state-partial title="Partly applied: a line stopped, with why and how to go on" state=error
<section class="change-set" data-status="partial" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Partly applied</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update" data-applied="">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-23"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-23</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
    </li>
    <li class="diff-line" data-kind="update" data-stopped="">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Save a card for next time” (SYN-99) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-99"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-99</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
      <p class="line-error" role="note">
        The source refused this change: SYN-99 can't be changed right now.<button
          type="button"
          class="quiet-action"
        >
          Remove this change
        </button>
      </p>
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary">Try again</button>
    <button type="button" class="quiet-action">Dismiss</button>
    <button type="button" class="button">Revert what was applied</button>
  </footer>
</section>
```

```html specimen id=state-stalled title="Apply stalled: its source stopped answering" state=error
<section class="change-set" data-status="applying" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Apply stalled</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="create">
      <p class="line-head">
        <span class="line-mark" data-kind="create">New story</span
        ><span class="new-title">Pay with a gift card</span>
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd>3 points</dd>
        </div>
      </dl>
    </li>
  </ul>
  <p class="apply-stuck">
    Its source hasn't answered for a while. Try again or dismiss it once it answers or Oriel gives
    up waiting.
  </p>
  <ul class="may-have-landed">
    <li>This may already be in Jira: check for “Pay with a gift card”</li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary">Try again</button>
    <button type="button" class="quiet-action">Dismiss</button>
  </footer>
</section>
```

```html specimen id=state-applied-folded title="Applied: folded to its head, then shown" state=done
<ol class="chat">
  <li>
    <section class="change-set" data-status="applied" data-folded tabindex="-1">
      <header class="change-set-head">
        <h2>Proposed change</h2>
        <span class="change-set-status" role="status">Applied</span>
        <span class="change-set-count">3 changes · <time>2 h ago</time></span>
        <button type="button" class="quiet-action" aria-expanded="false">Show</button>
      </header>
    </section>
  </li>
  <li>
    <section class="change-set" data-status="applied" data-folded tabindex="-1">
      <header class="change-set-head">
        <h2>Proposed change</h2>
        <span class="change-set-status" role="status">Applied, then undone</span>
        <span class="change-set-count">1 change · <time>yesterday</time></span>
        <button type="button" class="quiet-action" aria-expanded="false">Show</button>
      </header>
    </section>
  </li>
  <li>
    <section class="change-set" data-status="applied" aria-busy="false" tabindex="-1">
      <header class="change-set-head">
        <h2>Proposed change</h2>
        <span class="change-set-status" role="status">Applied</span>
        <button type="button" class="quiet-action" aria-expanded="true">Hide</button>
      </header>
      <ul class="diff">
        <li class="diff-line" data-kind="create" data-applied="">
          <p class="line-head">
            <span class="line-mark" data-kind="create">New story</span
            ><span class="new-title">Pay with a gift card</span>
          </p>
        </li>
      </ul>
      <footer class="change-set-actions">
        <button type="button" class="button">Revert</button>
      </footer>
    </section>
  </li>
</ol>
```

```html specimen id=state-rejected title="Rejected: folded to its head, then shown" state=rejected
<ol class="chat">
  <li>
    <section class="change-set" data-status="rejected" data-folded tabindex="-1">
      <header class="change-set-head">
        <h2>Proposed change</h2>
        <span class="change-set-status" role="status">Rejected</span>
        <span class="change-set-count">3 changes</span>
        <button type="button" class="quiet-action" aria-expanded="false">Show</button>
      </header>
    </section>
  </li>
  <li class="oriel-note" role="note">
    <p>Change rejected. You can ask the agent to make changes or close the thread.</p>
  </li>
  <li>
    <section class="change-set" data-status="rejected" aria-busy="false" tabindex="-1">
      <header class="change-set-head">
        <h2>Proposed change</h2>
        <span class="change-set-status" role="status">Rejected by Priya Shah via review link</span>
        <button type="button" class="quiet-action" aria-expanded="true">Hide</button>
      </header>
      <ul class="diff">
        <li class="diff-line" data-kind="update">
          <p class="line-head">
            <span class="sentence"
              >Estimate “Handle 3-D Secure challenges in the native checkout” (SYN-104) at 3 points.
              <a
                class="key source-link"
                href="https://synthetic.atlassian.net/browse/SYN-104"
                target="_blank"
                rel="noopener noreferrer"
                >SYN-104</a
              ></span
            >
          </p>
          <dl class="fields">
            <div class="field">
              <dt>Estimate</dt>
              <dd class="edited">
                <div class="side" data-side="after">
                  <span class="side-sign" aria-hidden="true">+</span
                  ><span class="side-text"
                    ><span class="visually-hidden">After: </span>3 points</span
                  >
                </div>
              </dd>
            </div>
          </dl>
        </li>
      </ul>
      <footer class="change-set-actions"></footer>
    </section>
  </li>
</ol>
```

```html specimen id=state-reverted title="Reverting: the Undo is a change set of its own, nested" state=revert
<section class="change-set" data-status="applied" aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Applied</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="create" data-applied="">
      <p class="line-head">
        <span class="line-mark" data-kind="create">New story</span
        ><span class="new-title">Pay with a gift card</span>
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd>3 points</dd>
        </div>
      </dl>
    </li>
  </ul>
  <footer class="change-set-actions"></footer>
  <section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
    <header class="change-set-head">
      <h2>Undo</h2>
      <span class="change-set-status" role="status">Awaiting review</span>
    </header>
    <ul class="diff">
      <li class="diff-line" data-kind="delete">
        <p class="line-head">
          <span class="line-mark" data-kind="delete">Delete</span
          ><span class="sentence"
            >Delete “Pay with a gift card” (SYN-900) from Jira.
            <a
              class="key source-link"
              href="https://synthetic.atlassian.net/browse/SYN-900"
              target="_blank"
              rel="noopener noreferrer"
              >SYN-900</a
            ></span
          >
        </p>
        <dl class="fields">
          <div class="field">
            <dt>Title</dt>
            <dd>
              <del>Pay with a gift card</del><span class="arrow" aria-hidden="true">→</span
              ><ins>—</ins>
            </dd>
          </div>
          <div class="field">
            <dt>Estimate</dt>
            <dd><del>3 points</del><span class="arrow" aria-hidden="true">→</span><ins>—</ins></dd>
          </div>
        </dl>
      </li>
    </ul>
    <footer class="change-set-actions">
      <button type="button" class="button primary">Approve and apply</button>
      <button type="button" class="button">Reject</button>
      <button type="button" class="quiet-action">Share review link</button>
    </footer>
  </section>
</section>
```

```html specimen id=state-opened title="Opened from a link: the accent mark" state=opened
<section class="change-set" data-status="open" data-opened aria-busy="false" tabindex="-1">
  <header class="change-set-head">
    <h2>Proposed change</h2>
    <span class="change-set-status" role="status">Awaiting review</span>
  </header>
  <ul class="diff">
    <li class="diff-line" data-kind="update">
      <p class="line-head">
        <span class="sentence"
          >Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.
          <a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-23"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-23</a
          ></span
        >
      </p>
      <dl class="fields">
        <div class="field">
          <dt>Estimate</dt>
          <dd class="edited">
            <div class="side" data-side="after">
              <span class="side-sign" aria-hidden="true">+</span
              ><span class="side-text"><span class="visually-hidden">After: </span>3 points</span>
            </div>
          </dd>
        </div>
      </dl>
    </li>
  </ul>
  <footer class="change-set-actions">
    <button type="button" class="button primary">Approve and apply</button>
    <button type="button" class="button">Reject</button>
    <button type="button" class="quiet-action">Share review link</button>
  </footer>
  <p class="change-set-problem" role="alert">Something went wrong. Try again.</p>
</section>
```

What each state is, and what it offers:

- **Awaiting review** (`open`): Approve and apply, Reject, Share review link, and × on each line that can be left out. Approve and Reject stay **disabled until the diff has loaded**, because approving sends the diff's hash: the person approves exactly what they were shown, and the server refuses a stale one (`updateThread` in `packages/web/src/thread.ts`). Until then the card says "Reading what each change would replace in its source…", with a spinner, and offers no steps at all, Second look and Share review link included: the diff reads each changed item's current values from its source, which takes seconds on a large set (OA-257). A diff that fails says why, and the steps come back, Approve and Reject still disabled.
- **Applying** (`applying`): once Approve is clicked, the card shows it at once, before the server answers (`expected` in `packages/web/src/thread.ts`): status "Applying…", `aria-busy="true"`, which dims the whole card to 0.7 (`.change-set[aria-busy="true"]` in `window.css`), and no steps (an empty footer hides itself, `.change-set-actions:empty` in `window.css`). There's no spinner: the status and the dimming are the whole signal. The [sidebar](/components/sidebar)'s chip for the thread says "Applying…" too.
- **Applied** (`applied`): the status turns `--done`; every applied line gets " ✓" after its sentence or title. Revert is offered, unless a source it wrote to can't take a change back, as a Slack post or a Linear issue made through its source server, which no tool deletes: then no Revert and no Undo show, and a `.change-set-foot` says why in the writer's own words, "A Linear issue or project can't be taken back." There's no partial revert. A set applied before the page opened **folds to its head**, with its count, when, and **Show**; Show opens it to its diff and Revert. One applied while the page is open stays shown, with **Hide**, until the page is left or reloaded, so the person sees what happened. Folding is the page's own; nothing is stored.
- **Partly applied** (`partial`) and **Stopped** (`stopped`): the line that failed is tinted `--danger-soft`, says why in `--danger` (`.line-error`, `role="note"`), and offers **Remove this change**. The steps: Try again, Dismiss, Revert what was applied.
- **Apply stalled**: its source stopped answering mid-apply. Nothing can be done until it answers or Oriel gives up waiting, since a send may yet land (OA-82). `.apply-stuck` (on `--accent-soft`) says so; Dismiss lists what may already be in the source first (`.may-have-landed`, on `--derived-soft`), so the person can check before they let it go.
- **Rejected** (`rejected`): one click, no confirm. The status is struck through, and the set **folds to its head** with its count and **Show**, so a revised change set below isn't buried (OA-90); a link to it unfolds it. Oriel then adds its own note under it and moves focus to the composer, for what was wrong. The [bead](/components/bead) says "You rejected the change in “…”." with **Undo**, which puts it back to awaiting review as it was, its second look too, and Oriel's line "Rejection undone. The change awaits your review." under the first (OA-258). Once the person has said anything to the agent since, the Undo is refused, and the bead says why until dismissed. A rejection on the review link has no Undo.
- **Reverted:** Revert proposes a new change set, headed **Undo**, nested inside the one it reverts (dashed, inset, `.change-set .change-set` in `window.css`), and reviewed the same way. A revert is never a one-click Undo. While the Undo awaits review, is applying or failed, the set it reverts can't fold; once the Undo is applied or rejected, both fold as an applied set does, and the outer one says "Applied, then undone". A link to the Undo opens the set it sits in.
- **Opened from a link** (`[data-opened]`): when a link or a search result names the set, the page scrolls it under the head row and focuses it (`perform` in `packages/web/src/effects.ts`). The card shows an accent border and ring instead of the focus ring (`.change-set:focus` in `window.css` has no outline).
- **Problem:** a refusal of a click shows under the footer, `.change-set-problem`, `role="alert"`, on `--danger-soft`, in the server's words; the page then reads the diff again.
- **Hover:** each line's × shows on the line's hover; the buttons have their own. **Active** isn't styled.
- **Disabled:** every step and × is disabled while the set is busy. The × has no disabled look and still turns red on hover (see Drift).
- **Empty** doesn't apply: a change set always has at least one line.

## Keyboard and ARIA

- The card is a `<section>` with `tabindex="-1"`: not in the tab order, but focusable, so a link can land on it. It sets `aria-busy` while busy.
- The status is `role="status"`, so a screen reader hears it move: "Applying…", "Applied".
- The "−" and "+" signs are `aria-hidden`. A reader hears "Before: " and "After: " from `.visually-hidden` spans, then the text. `<del>` and `<ins>` carry the word marks.
- A delete's arrow is `aria-hidden`.
- Folded unchanged lines are a native `<details>`: Enter or Space opens them.
- The × is a `<button>` named **Leave this change out** (`aria-label`), with a tooltip of the same words (so the tooltip is `aria-hidden`, not a description).
- Show and Hide set `aria-expanded`, and are described by the head's title, status and count, so a reader hears "Show, collapsed: Proposed change, Applied, 3 changes · 2 h ago". The head is not a second control: its click lands on the button. Folding doesn't animate, so reduced motion has nothing to stop.
- The review link's field is read-only and named "Review link". **Copy** writes the link to the clipboard and says nothing (`perform` in `packages/web/src/effects.ts`).
- A line's error is `role="note"`; a click's refusal is `role="alert"`.
- After Reject, focus moves to the composer (`perform` in `packages/web/src/effects.ts`).

## Content

- The head says what kind of thing it is: **Proposed change**. A revert says **Undo**.
- Each line's sentence is the source catalogue's, with the item by title and key: "Estimate “Pay with a phone wallet on the website” (SYN-23) at 3 points.", "Change the estimate of “Save a card for next time” (SYN-99) from 2 points to 3 points.", "Rewrite the description of …", "Delete “…” (SYN-901) from Jira."
- Field names are the person's words, not the source's: Title, Description, Estimate, Assignee, Epic, Status, Replies; Link and Reply for one of several (`fieldNames` in `packages/web/src/thread-page.tsx`). An estimate is in points: "3 points", "1 point".
- The primary says what it does: **Approve and apply**. Not "Approve", not "OK" (the review link's page says Approve: see Drift).
- An error says what happened, and the line offers the way on: "The source refused this change: SYN-99 can't be changed right now." **Remove this change**.
- What may have landed names where to look: "This may already be in Jira: check SYN-23", "… check for “Pay with a gift card”", "… check for the item it creates".

## The review link page

A review link hands one change set to someone outside Oriel, by a URL. Its page has no sidebar, no thread and no window: one card, headed by Oriel's mark (`.review`, at most 40rem, centred). **Nothing opens until the person asks**, with a POST, since chat apps fetch links to preview them (`packages/web/src/review.ts`).

The link can only approve, approve the rest, reject or dismiss; retry, remove and revert stay in the thread. The page asks in this order: **the change first**, and what Approve writes over it; then **Your answer**, the steps the engine offers as radios (`.review-answer`, with `.choices`), nothing picked until the person picks; **the note**, which only Reject opens, and which says where its words go: "It goes to whoever sent you this link, and their agent sees it only if they send it on."; then **Your name**; then **one button that says what it does**, "Approve and apply", "Reject" or "Dismiss", once there's an answer for it to send (`reviewParts` in `packages/web/src/review.ts`). With only one step offered, that's the answer, and there's nothing to pick. The note is optional, and it doesn't reach the agent: it's held in the thread for whoever shared the link ([a held message](/components/message#a-held-message)). Only a rejection sends it.

This page can open in the person's default browser, so it may be Safari or Firefox. Anything in window.css it reaches must degrade there.

```html specimen id=review-closed title="Before it opens" width=640
<main class="review">
  <header class="review-head">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" /></svg
    ><span>Oriel</span>
  </header>
  <section class="review-card">
    <h1 class="page-title">A change to review</h1>
    <p>
      Someone using Oriel wants a change made and shared this link so you can review it. Nothing is
      changed until it is approved.
    </p>
    <button type="button" class="button primary">Show the change</button>
  </section>
</main>
```

```html specimen id=review-open title="Open: the change first, then the answer, the note Reject opens, the name and one button"
<main class="review">
  <header class="review-head">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" /></svg
    ><span>Oriel</span>
  </header>
  <section class="review-card">
    <h1 class="page-title">Review this change</h1>
    <p class="review-writes">1 new story in Jira</p>
    <ul class="diff">
      <li class="diff-line" data-kind="create">
        <p class="line-head">
          <span class="line-mark" data-kind="create">New story</span
          ><span class="new-title">Pay with a gift card</span>
        </p>
        <!-- prettier-ignore -->
        <p class="new-description">Enter the code from the card. A balance that doesn't cover the fare is topped up with another way to pay.</p>
        <dl class="fields">
          <div class="field">
            <dt>Estimate</dt>
            <dd>3 points</dd>
          </div>
          <div class="field">
            <dt>Epic</dt>
            <dd>
              <span class="item-value"
                >Checkout v2: phone wallets and saved cards<a
                  class="key source-link"
                  href="https://synthetic.atlassian.net/browse/SYN-1"
                  target="_blank"
                  rel="noopener noreferrer"
                  >SYN-1</a
                ></span
              >
            </dd>
          </div>
        </dl>
      </li>
    </ul>
    <form class="review-decide">
      <fieldset class="review-answer">
        <legend>Your answer</legend>
        <div class="choices">
          <label class="choice"
            ><input type="radio" name="review-answer" value="approve" />Approve and apply</label
          >
          <label class="choice"
            ><input type="radio" name="review-answer" value="reject" checked />Reject</label
          >
        </div>
      </fieldset>
      <div class="name-field reason">
        <label for="review-note">What's wrong? (optional)</label>
        <p class="name-field-help" id="review-note-help">
          It goes to whoever sent you this link, and their agent sees it only if they send it on.
        </p>
        <textarea
          id="review-note"
          aria-describedby="review-note-help"
          rows="2"
          maxlength="2000"
        ></textarea>
      </div>
      <label class="name-field">Your name<input maxlength="120" autocomplete="name" /></label>
      <div class="review-actions">
        <button type="submit" class="button primary">Reject</button>
      </div>
    </form>
    <p class="read-only-note" role="status"></p>
  </section>
</main>
```

```html specimen id=review-deciding title="Deciding, and a missing name"
<div class="ws-stack">
  <section class="review-card">
    <h1 class="page-title">Review this change</h1>
    <form class="review-decide">
      <label class="name-field"
        >Your name<input maxlength="120" autocomplete="name" value="Priya Shah" disabled
      /></label>
      <div class="review-actions">
        <button type="submit" class="button primary" disabled>Approve and apply</button>
      </div>
    </form>
    <p class="read-only-note" role="status">Approving and applying…</p>
  </section>
  <section class="review-card">
    <h1 class="page-title">Review this change</h1>
    <form class="review-decide">
      <label class="name-field">Your name<input maxlength="120" autocomplete="name" /></label>
      <div class="review-actions">
        <button type="submit" class="button primary">Approve and apply</button>
      </div>
    </form>
    <p class="read-only-note" role="status"></p>
    <p class="change-set-problem" role="alert">Type your name first.</p>
  </section>
</div>
```

The name field isn't disabled while deciding in the app; only the buttons are. The first card above disables it to show the whole form at rest; copy the app.

```html specimen id=review-decided title="Decided: approved, rejected, stopped part way"
<div class="ws-stack">
  <section class="review-card">
    <h1 class="page-title">You approved this change</h1>
    <p>Thanks, Priya Shah.</p>
    <p class="outcome" data-status="applied">Every change in it has been made.</p>
  </section>
  <section class="review-card">
    <h1 class="page-title">You rejected this change</h1>
    <p>Thanks, Dana Reyes.</p>
    <p>
      What you said is in the thread for whoever shared this link. They decide whether the agent
      sees it.
    </p>
    <p class="outcome" data-status="rejected">Nothing will be changed.</p>
  </section>
  <section class="review-card">
    <h1 class="page-title">You approved this change</h1>
    <p>Thanks, Priya Shah.</p>
    <p class="outcome" data-status="partial">
      Some of it was made, then Oriel stopped. The rest wasn't made:
    </p>
    <ul class="outcome-stops">
      <li>
        <span>Estimate “Save a card for next time” (SYN-99) at 3 points. </span
        ><span class="stop-reason"
          >The source refused this change: SYN-99 can't be changed right now.</span
        >
      </li>
    </ul>
  </section>
  <section class="review-card">
    <h1 class="page-title">This link no longer works</h1>
    <p>This review link has expired, was revoked, or was already used.</p>
  </section>
</div>
```

- **Closed:** "A change to review", the promise ("Nothing is changed until it is approved."), and **Show the change**, disabled while it opens.
- **Open:** "Review this change", the same diff as the thread (no ×, no Remove this change; [chips](/components/chip) are plain text, as nothing can navigate), what dismissing may leave, then the form. With no step to take: "There's nothing to decide here now. Whoever shared this link can take it from the thread." or "Applying…".
- **Deciding:** the buttons are disabled; an approval says "Approving and applying…" in the always-present `role="status"` line.
- **A missing name:** "Type your name first.", checked on click, in `.change-set-problem` with `role="alert"`. The buttons aren't disabled for an empty name, and the field gets no `aria-invalid` (see [Forms](/patterns/forms)).
- **Decided:** "You approved this change" / "You rejected this change" / "You dismissed the rest of this change", "Thanks, {name}.", a rejection's "This link has closed, so the rejection can't be undone here. If you didn't mean it, tell whoever shared the link: they can ask for the change again." (OA-258), and exactly what happened (`.outcome`, danger when partial or stopped), with each stop beside the change it stopped at.
- **Dead:** "This link no longer works", and the server's reason, such as "This review link has expired, was revoked, or was already used." (`api` in `packages/server/src/api.ts`).
- **Keyboard:** the decision is a `<form>` whose one button is `type="submit"`, so Enter in the name field sends the answer picked; with none, "Pick your answer first." The answer is a radio group: arrow keys move between its steps.

## Where the app uses it

- `ChangeSet` in `packages/web/src/thread-page.tsx` draws the card, its folded head, its steps and its review link; `ChatEntryItem` in `packages/web/src/thread-page.tsx` places it as a chat entry. Status words: `statusNames` in `packages/web/src/thread-page.tsx`. "Apply stalled": `waitingNames` in `packages/web/src/parts.tsx`.
- The engine's steps and their order: `changeSetsOver` in `packages/changeset/src/change-sets.ts`. Labels: `stepLabel` in `packages/web/src/thread.ts`. Folding: `folded` in `packages/web/src/thread.ts`. Showing a decision before the server answers: `expected` in `packages/web/src/thread.ts`.
- `Diff`, `Edited` and `NewItem` in `packages/web/src/thread-page.tsx`; `Diff` draws the ×. Word marks: `packages/web/src/text-diff.ts`.
- CSS: the card `.change-set`, `.change-set-head`, `.change-set-head h2`, `.change-set-status` and `.change-set-count` in `window.css`, with their state variants; lines `.diff`, `.diff-line`, `.line-error`, `.apply-stuck`, `.may-have-landed`, `.read-only-note`, `.line-head`, `.line-mark`, `.new-title`, `.new-description`, `.item-value`, `.new-mark`, `.sentence .key`, `.fields`, `.field`, `.arrow`, `.side`, `.side-sign`, `.side-text`, `.fold summary` and `.remove-line` in `window.css`; the footer `.change-set-actions` in `window.css`; the link `.review-link` in `window.css`; the problem `.change-set-problem` in `window.css`; the × `.remove-line`, `.diff-line:hover .remove-line` and `.remove-line:hover` in `window.css` (rules shared with `.remove-member`).
- The review link page: `ReviewPage`, `ReviewChange` and `Outcome` in `packages/web/src/other-pages.tsx`; its stages, `ReviewModel` in `packages/web/src/review.ts`. CSS: `.review`, `.review-head`, `.review-card`, `.review-card .review-writes`, `.review-decide`, `.review-answer`, `.name-field`, `.name-field-help`, `.review-actions`, `.outcome`, `.outcome-stops` and `.stop-reason` in `window.css`.

## Drift

Status **drifting**. The card is one component; what drifts is around it:

- **The ×** is styled in two places (the rules it shares with `.remove-member` in `window.css`, and its position on `.remove-line` in `window.css`), has no disabled look, and its hover isn't guarded, so a busy card's × still turns red.
- **No Revoke.** Decision 0024 lists revoking review links as a person's action; the web has no control for it. **Copy** gives no confirmation.
- **The focused card has no ring** (`.change-set:focus` in `window.css`); only `[data-opened]` shows where a link landed.
- `<span class="stop-change">` on the review page's stops (`Outcome` in `packages/web/src/other-pages.tsx`) has no rules, so the specimen leaves it off.

Until these are settled, copy `ChangeSet` and `Diff` from `thread-page.tsx` as they are; don't hand-copy the diff. The review page's `ReviewChange` in `packages/web/src/other-pages.tsx` imports `Diff`; do the same.
