---
title: Second look
status: stable
group: Thread
order: 52
classes: second-look, second-look-head, second-look-by, second-look-read, second-look-note, second-look-none, second-look-stale, second-look-kind, finding, finding-says, finding-on, suggested, suggested-added
summary: The agent's reading of what else a change set could affect, taken only when the person asks (decision 0054), between the diff and Approve. Findings with word-for-word quotes, never a verdict.
---

# Second look

## What it is

A second look is Oriel's own run on a [change set](/components/change-set) nobody has decided on, taken only when the person presses **Second look** (decision 0054). It reads the diff Oriel computed and what it chooses, and records **findings**: what else the change could make wrong. Its card sits in the change set, between the diff and its steps.

"The agent's reading of what else the change would make wrong, never a verdict. Nothing here approves, rejects or blocks, and nothing looks like a pass: no tick, no green, no score, and no summary line, since the agent writes none. What Oriel knows for itself (what the look read, which quotes it found word for word, what changed since) is said in Oriel's words; what the agent concluded is captioned as its own." (`packages/web/src/second-look.tsx`)

A finding is one of four kinds, each under its heading, in this order: **Disagrees with something decided**, **A discussion this affects**, **May need to change with it**, **Worth a look**. Each names the diff lines it bears on, says in one or two sentences what the agent read, and quotes one to four passages, each found word for word in an item or in what a diff line would write. A finding that the change needs a companion change carries it, as a sentence with **Add to this change set**.

## When to use it

- On a change set nobody has decided on, when the person wants to know what else it touches before approving. The button is theirs to press.
- For findings that quote what they rest on. Oriel keeps a finding only when every quote is word for word.

## When not to

- Not as a gate. Approve and Reject never wait for it, and nothing it says changes what they do. It never blocks, and never passes.
- Not started by anything but the person: not a capture, a sync or a page view, and not the agent (`changeset.second-look` is closed to the agent and outside tools).
- Not on the review link's page. A link can be forwarded to anyone, and a look quotes beyond the diff.
- Not in the done, accent or danger colours, or with a tick or a score: nothing in it may read as a pass or a block.

## Anatomy and variants

The card is `section.second-look`, `data-state` its state, named "Second look": set apart from the diff by a dashed `--line-strong` border on `--surface-sunk`, `--radius`, inset by `--space-3` in the change set. In neutral tones only.

1. **The head** (`.second-look-head`): **Second look** (`h3`, `--text-md`, strong), and, faint, whose it is (`.second-look-by`): "The agent's reading of what else this could affect. Not a review: it can miss things, and it never approves."
2. **What changed since** (`.second-look-stale`, `role="note"`), when something did: muted, `--text-sm`, behind a thick `--line-strong` rule.
3. **What it read** (`.second-look-read`, faint), Oriel's count from the runs' records: "It read 3 of 11 items in this workstream, and searched outside it twice. It can't speak for what it didn't read."
4. **The findings**, by kind (`.second-look-kind`, `data-kind`), each under a muted `h4`. A finding (`li.finding`) is its sentence (`.finding-says`), led by where it bears (`.finding-on`, muted and strong: "On SYN-45:"), then its quotes, each a `.quote-from` with a thick `--line-strong` rule (the [message](/components/message) page's figure, neutral here), captioned "Word for word from" and the item's chip, "· outside this workstream" when it is, or "Word for word from what SYN-45 would write".
5. **Suggested changes** (`ul.suggested`), under a companion: each a bordered row on `--surface`, its sentence, then **Add to this change set** (`.quiet-action`), or, once added, faint **Added to this change set** (`.suggested-added`).

```html specimen id=ready title="Findings: a conflict with a decision, and a change that may need to go with it"
<section class="second-look" data-state="ready" aria-label="Second look">
  <header class="second-look-head">
    <h3>Second look</h3>
    <span class="second-look-by"
      >The agent's reading of what else this could affect. Not a review: it can miss things, and it
      never approves.</span
    >
  </header>
  <p class="second-look-read">
    It read 3 of 11 items in this workstream, and searched outside it twice. It can't speak for what
    it didn't read.
  </p>
  <div class="second-look-kind" data-kind="conflict">
    <h4>Disagrees with something decided</h4>
    <ul>
      <li class="finding">
        <p class="finding-says">
          <span class="finding-on">On SYN-45:</span> The new text says next-day sailings are case by
          case, but the later reply in the decision's thread says ops agreed they follow the same
          rule.
        </p>
        <figure class="quote-from" data-found="true">
          <figcaption>
            Word for word from
            <span
              class="chip"
              data-kind="item"
              title="Message: Decision: when a sailing is cancelled for weather, passengers keep the fare they paid on any later sailing that day, even a dearer one."
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Decision:</span></span
                ><span class="chip-name"> when a sailing is cancelled for…</span></a
              ></span
            >
            · outside this workstream
          </figcaption>
          <blockquote>
            <p>
              ops agreed that next-day sailings now follow the same rule, so passengers keep their
              fare on the next day's sailings too.
            </p>
          </blockquote>
        </figure>
        <figure class="quote-from" data-found="true">
          <figcaption>Word for word from what SYN-45 would write</figcaption>
          <blockquote><p>Next-day sailings are case by case: support decides.</p></blockquote>
        </figure>
      </li>
    </ul>
  </div>
  <div class="second-look-kind" data-kind="companion">
    <h4>May need to change with it</h4>
    <ul>
      <li class="finding">
        <p class="finding-says">
          <span class="finding-on">On SYN-45:</span> The cancellation screen's compensation copy,
          SYN-29, explains the same fare rule, and would no longer match it.
        </p>
        <figure class="quote-from" data-found="true">
          <figcaption>
            Word for word from
            <span
              class="chip"
              data-kind="item"
              title="Message: Handing over the compensation rules copy (SYN-29) before I leave. The draft is in the plans folder."
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1789902000000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Handing</span></span
                ><span class="chip-name"> over the compensation rules copy…</span></a
              ></span
            >
          </figcaption>
          <blockquote>
            <p>Handing over the compensation rules copy (SYN-29) before I leave.</p>
          </blockquote>
        </figure>
        <ul class="suggested">
          <li>
            <span
              >Rewrite the description of “Explain compensation rules on the cancellation screen”
              (SYN-29).</span
            ><button type="button" class="quiet-action">Add to this change set</button>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</section>
```

The button that asks for it is a plain `.button` in the change set's footer, between the forward steps and Reject: **Second look**, then **Looking…** while it runs, and **Look again** once the change set or an item it rests on changed, or the last look failed. With a current look there's no button. Its tooltip says what pressing does.

```html specimen id=button title="The button, between Approve and Reject" height=150
<footer class="change-set-actions">
  <button type="button" class="button primary">Approve and apply</button>
  <button type="button" class="button" aria-describedby="tip-look">Second look</button>
  <span id="tip-look" role="tooltip" popover="manual" class="tooltip"
    >Oriel reads what else this change could affect, in a run of its own. It never approves.</span
  >
  <button type="button" class="button">Reject</button>
  <button type="button" class="quiet-action">Share review link</button>
</footer>
```

## States

```html specimen id=state-running title="Running: Approve and Reject don't wait" state=busy
<section class="second-look" data-state="running" aria-label="Second look">
  <header class="second-look-head">
    <h3>Second look</h3>
    <span class="second-look-by"
      >The agent's reading of what else this could affect. Not a review: it can miss things, and it
      never approves.</span
    >
  </header>
  <p class="second-look-note" role="status">
    Reading what this change touches. Nothing waits for it.
  </p>
</section>
```

```html specimen id=state-running-button title="Looking…: the button, disabled and busy" state=busy
<footer class="change-set-actions">
  <button type="button" class="button primary">Approve and apply</button>
  <button type="button" class="button" disabled aria-busy="true">Looking…</button>
  <button type="button" class="button">Reject</button>
</footer>
```

```html specimen id=state-none title="Ready, with nothing raised"
<section class="second-look" data-state="ready" aria-label="Second look">
  <header class="second-look-head">
    <h3>Second look</h3>
    <span class="second-look-by"
      >The agent's reading of what else this could affect. Not a review: it can miss things, and it
      never approves.</span
    >
  </header>
  <p class="second-look-read">
    It read 3 of 11 items in this workstream, and searched outside it twice. It can't speak for what
    it didn't read.
  </p>
  <p class="second-look-none">
    It raised nothing from what it read. That isn't a sign the change is right: the diff above is
    yours to check.
  </p>
</section>
```

```html specimen id=state-stale title="Stale: a suggestion added, and an item it rests on changed since"
<section class="second-look" data-state="ready" aria-label="Second look">
  <header class="second-look-head">
    <h3>Second look</h3>
    <span class="second-look-by"
      >The agent's reading of what else this could affect. Not a review: it can miss things, and it
      never approves.</span
    >
  </header>
  <p class="second-look-stale" role="note">
    You added a suggestion since it looked; nobody has looked at what that adds. 1 item it rests on
    changed since:
    <span
      class="chip"
      data-kind="item"
      data-state="done"
      title="SYN-29: Explain compensation rules on the cancellation screen, done"
      ><a
        class="chip-link"
        href="https://synthetic.atlassian.net/browse/SYN-29"
        target="_blank"
        rel="noopener noreferrer"
        ><span class="chip-lead"
          ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
            <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
          ><span class="chip-key">SYN-29</span></span
        >
        <span class="chip-name">Explain compensation rules on the cancellation screen</span
        ><span class="chip-state">Done</span></a
      ></span
    >.
  </p>
  <p class="second-look-read">
    It read 3 of 11 items in this workstream, and searched outside it twice. It can't speak for what
    it didn't read.
  </p>
  <div class="second-look-kind" data-kind="conflict">
    <h4>Disagrees with something decided</h4>
    <ul>
      <li class="finding">
        <p class="finding-says">
          <span class="finding-on">On SYN-45:</span> The new text says next-day sailings are case by
          case, but the later reply in the decision's thread says ops agreed they follow the same
          rule.
        </p>
        <figure class="quote-from" data-found="true">
          <figcaption>
            Word for word from
            <span
              class="chip"
              data-kind="item"
              title="Message: Decision: when a sailing is cancelled for weather, passengers keep the fare they paid on any later sailing that day, even a dearer one."
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1788444000000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Decision:</span></span
                ><span class="chip-name"> when a sailing is cancelled for…</span></a
              ></span
            >
            · outside this workstream
          </figcaption>
          <blockquote>
            <p>
              ops agreed that next-day sailings now follow the same rule, so passengers keep their
              fare on the next day's sailings too.
            </p>
          </blockquote>
        </figure>
        <figure class="quote-from" data-found="true">
          <figcaption>Word for word from what SYN-45 would write</figcaption>
          <blockquote><p>Next-day sailings are case by case: support decides.</p></blockquote>
        </figure>
      </li>
    </ul>
  </div>
  <div class="second-look-kind" data-kind="companion">
    <h4>May need to change with it</h4>
    <ul>
      <li class="finding">
        <p class="finding-says">
          <span class="finding-on">On SYN-45:</span> The cancellation screen's compensation copy,
          SYN-29, explains the same fare rule, and would no longer match it.
        </p>
        <figure class="quote-from" data-found="true">
          <figcaption>
            Word for word from
            <span
              class="chip"
              data-kind="item"
              title="Message: Handing over the compensation rules copy (SYN-29) before I leave. The draft is in the plans folder."
              ><a
                class="chip-link"
                href="https://ferrowick-example.slack.com/archives/C0FW1WEATHR/p1789902000000100"
                target="_blank"
                rel="noopener noreferrer"
                ><span class="chip-lead"
                  ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></svg
                  ><span class="chip-name">Handing</span></span
                ><span class="chip-name"> over the compensation rules copy…</span></a
              ></span
            >
          </figcaption>
          <blockquote>
            <p>Handing over the compensation rules copy (SYN-29) before I leave.</p>
          </blockquote>
        </figure>
        <ul class="suggested">
          <li>
            <span
              >Rewrite the description of “Explain compensation rules on the cancellation screen”
              (SYN-29).</span
            ><span class="suggested-added">Added to this change set</span>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</section>
```

```html specimen id=state-error title="Failed: it didn't finish" state=error
<section class="second-look" data-state="failed" aria-label="Second look">
  <header class="second-look-head">
    <h3>Second look</h3>
    <span class="second-look-by"
      >The agent's reading of what else this could affect. Not a review: it can miss things, and it
      never approves.</span
    >
  </header>
  <p class="second-look-note">It didn't finish: Oriel stopped before it finished.</p>
</section>
```

```html specimen id=state-focus title="Focus visible: Add to this change set" state=focus-visible
<ul class="suggested">
  <li>
    <span
      >Rewrite the description of “Explain compensation rules on the cancellation screen”
      (SYN-29).</span
    ><button type="button" class="quiet-action ws-focus-visible">Add to this change set</button>
  </li>
</ul>
```

- **Running** (`data-state="running"`): "Reading what this change touches. Nothing waits for it.", `role="status"`. The button reads Looking…, disabled and `aria-busy`.
- **Ready** (`data-state="ready"`): what it read, then the findings, or, with none, "It raised nothing from what it read. That isn't a sign the change is right: the diff above is yours to check." (`.second-look-none`, muted).
- **Stale:** what changed since it looked, above what it read. A look is stored and never regenerated on a view; the person presses Look again.
- **Failed** (`data-state="failed"`): "It didn't finish", with why when there is one. The button reads Look again.
- **Busy:** while the change set is busy, Add to this change set is disabled.
- **Hover and focus:** a `.quiet-action`'s and a `.button`'s. The chips in captions are links, with the global ring.

## Keyboard and ARIA

- The card is a `section` named "Second look", its head an `h3` under the change set's `h2`, each kind an `h4`.
- The running note is `role="status"`, so the look's start is read out; what changed since is `role="note"`.
- Findings are list items, grouped by kind; suggested changes are a list.
- Tab reaches each quote's chip, then Add to this change set. The button's tooltip describes it (`aria-describedby`).

## Content

- Oriel's own words for what Oriel knows: what it read ("It read 3 of 11 items in this workstream, and searched outside it twice."), what changed since ("The change set changed after it looked."), and "Word for word from".
- The agent's words only in a finding's sentence, under the head that says whose they are.
- Never a grade: no "safe", "looks good", "no issues". Oriel keeps no finding that says one.
- Headings are fixed: "Disagrees with something decided", "A discussion this affects", "May need to change with it", "Worth a look" (`kinds` in `packages/web/src/second-look.tsx`).
- A finding leads with where it bears: "On SYN-45:", or "On change 2:" for a line with no item.

## Where the app uses it

- `SecondLook` in `packages/web/src/second-look.tsx`, placed by `ChangeSet` in `packages/web/src/thread-page.tsx`, between the diff and the steps. The button: `SecondLookButton` in `packages/web/src/thread-page.tsx`.
- The run, its checks and what it keeps: `packages/server/src/challenger.ts`. Adding a suggestion: `changeset.add-suggestion`, through `ChangeSets.extend`.
- CSS: `.second-look`, `.second-look-head`, `.second-look-stale`, `.second-look-kind h4`, `.finding-says`, `.finding-on`, `.second-look .quote-from blockquote`, `.second-look .suggested li` and `.suggested-added` in `window.css`.

Two hooks in the app's markup have no rule in window.css: `class="second-look-button"` on the button and `class="suggested-change"` on a suggestion's sentence. The specimens leave them off.
