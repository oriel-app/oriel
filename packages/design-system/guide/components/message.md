---
title: Thread messages
status: stable
group: Thread
order: 60
classes: window-chat-moved, thread-layout, thread, thread-head, crumb, thread-title-row, thread-title, state-chip, chat, user-message, about, reply, table-scroll, quote-from, marker, ref-title, key, source-link, run, run-body, run-meta, code, output, run-error, hint, working, working-dot, notice, oriel-note, actions-block, action-lines, action-text, held-block, held-message, draft-card, held-by, held-from, continue-block, held-text, held-field, held-actions, held-note, draft-changes, draft-was, visually-hidden
summary: What a thread's conversation holds, entry by entry: the person's message, the agent's reply, its runs, Oriel's own lines, held messages and drafts, and "Working…".
---

# Thread messages

## What it is

A thread's conversation is one ordered list, `<ol class="chat">`, and every entry in it is one `<li>`. Some entries are words: the person's message, the agent's reply. The rest are what Oriel draws around those words, from its own data: a run the agent made, a [block](/components/block) or a sketch under the reply, a [change set](/components/change-set), what Oriel did for the agent, a line where the thread's items moved, a note after a rejection, a message held for the person, a draft.

The rule that shapes all of them: **whose words are these?** The person's message is a bubble on the right. The agent's reply is plain prose at full width. Everything Oriel says itself is set apart (faint, ruled, boxed or dashed), so it can never be mistaken for the agent's words, and the agent can never draw something that looks like Oriel's.

One renderer, `ChatEntryItem` in `packages/web/src/thread-page.tsx`, draws every entry, for a thread's page and for the window chat (`WindowChat` in `packages/web/src/window-chat-view.tsx`). So an entry looks the same in both.

| Entry                   | Markup                                         | Whose words                                               |
| ----------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| The person's message    | `li.user-message`                              | the person's                                              |
| The agent's reply       | `li.reply`, markdown                           | the agent's                                               |
| A run                   | `li` > `details.run`                           | Oriel's record of the agent's run                         |
| A block, a sketch       | `li` > `figure.answer-block`, `.answer-sketch` | Oriel's (see [Block](/components/block))                  |
| A change set            | `li` > `section.change-set`                    | Oriel's (see [Change set](/components/change-set))        |
| What Oriel did          | `li.actions-block`                             | Oriel's                                                   |
| A marker                | `li.marker`                                    | Oriel's                                                   |
| A note                  | `li.oriel-note`                                | Oriel's                                                   |
| A limit or an error     | `li.notice`                                    | Oriel's                                                   |
| A held message, a draft | `li.held-block` > `section.held-message`       | someone else's, or the agent's draft, held for the person |
| Continue in…            | `li.continue-block` > `button`, then `a`       | the agent's draft, one button for the person              |
| Working…                | `li.working`                                   | Oriel's                                                   |

## When to use it

- For anything a thread or the window chat shows in its conversation. Add a new kind of entry as one more `case` in `ChatEntryItem`, so both places get it.
- Draw the reply with `Markdown` in `packages/web/src/parts.tsx` and `answer` set, so the agent's `[[id]]` become [chips](/components/chip) and its quotes from items get Oriel's check.
- Use Oriel's own lines (`.oriel-note`, `.marker`, `.notice`, `.actions-block`) for anything Oriel says. Never put Oriel's words in a reply, and never let the agent's text into one of these.

## When not to

- Not for the agent's data. A table, bars or rows Oriel built from a read is a [block](/components/block), not a markdown table in the reply.
- Not for a decision. A change set is its own entry with its own steps; a reply never carries a button.
- Not for anything the person must act on that the agent wrote. If someone other than the person wrote it, it's a held message, and only the person sends it on.
- Not as a toast. What the person did (removed an item, made a workstream) shows as a note in the [bead](/components/bead), not in the chat.

## Anatomy and variants

### A thread, top to bottom

The page is `.thread-layout`: the thread in the middle (`main.thread`, at most `--chat`, 44rem, wide) and the [right rail](/components/right-rail) beside it. The thread is its head (the workstream as a crumb, the title, its [state chip](/components/chip), Mark done), the chat, and the [composer](/components/chat-input), sticky at the foot.

```html specimen id=thread title="A thread with a change set waiting for review" height=620
<main class="thread" aria-busy="false">
  <header class="thread-head">
    <a class="crumb" href="/workstream/checkout-v2">Checkout v2: phone wallets and saved cards</a>
    <div class="thread-title-row">
      <h1 class="thread-title" tabindex="-1">Which stories here still need estimates?</h1>
      <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
      <button type="button" class="quiet-action">Mark done</button>
    </div>
  </header>
  <ol class="chat">
    <li class="user-message">Which stories here still need estimates?</li>
    <li class="reply">
      <p>I'll find stories here without an estimate and propose 3 points for each.</p>
    </li>
    <li>
      <details class="run" data-outcome="ok">
        <summary>Ran a script · 1 read · 3 changes</summary>
        <div class="run-body">
          <pre class="code">const stories = await jira.search({ estimate: null });</pre>
        </div>
      </details>
    </li>
    <li class="reply">
      <p>
        If any needed one, the proposed change is below. Nothing is written until you approve it.
      </p>
    </li>
    <li>
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
                    ><span class="side-text"
                      ><span class="visually-hidden">After: </span>3 points</span
                    >
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
      </section>
    </li>
    <li class="marker" role="note">
      <span
        >Added
        <span
          ><a
            class="key source-link"
            href="https://synthetic.atlassian.net/browse/SYN-3"
            target="_blank"
            rel="noopener noreferrer"
            >SYN-3</a
          ><span class="ref-title"> Weather disruptions and rebooking</span></span
        ></span
      >
    </li>
  </ol>
  <div class="chat-dock">
    <form class="chat-input" data-elevation="raised">
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

The app wraps a run, a block, a sketch and a change set in `<li class="run-block">`, `block-entry`, `sketch-entry` and `change-set-block` (`ChatEntryItem` in `packages/web/src/thread-page.tsx`). Those classes have no rules in window.css, so the specimens here leave them off; keep them in the app, where tests and shots can find entries by them.

### The person's message

A bubble on the right, at most 85% wide (92% in a narrow page), on `--surface-hover`, in `--text-lg`. Its text is exactly what was sent: `white-space: pre-wrap`, never markdown.

```html specimen id=user-message title="The person's message"
<ol class="chat">
  <li class="user-message">Find anything about weather</li>
  <!-- prettier-ignore -->
  <li class="user-message">I'm meeting the payments team on Thursday.
Which of these need a decision from them first?</li>
</ol>
```

A message sent while looking at an item (decision 0062) keeps a line under its words, `.about`, in `--text-sm` and `--text-faint`: "about" and each item's chip, drawn by Oriel from its own data, with "(read-only)" after one that was outside the thread's region. It survives a reload. The window chat never says read-only.

```html specimen id=user-message-about title="The person's message, about an item"
<ol class="chat">
  <li class="user-message">
    Does this touch checkout?<span class="about"
      >about
      <span class="chip" data-kind="item"
        ><span class="chip-key">SYN-54</span> Cancellation alert sent for a sailing</span
      >
      (read-only)</span
    >
  </li>
</ol>
```

### The agent's reply

Markdown at full width, `--text-lg` at 1.55 leading. Headings start at `h3`, since the page holds `h1` and the change set `h2`. A table is wrapped in `.table-scroll` so a wide one scrolls inside the reply, not the page. Code is mono on `--surface-sunk`. A link opens only to a site the thread's own items come from; any other shows its label and its address as text (`Markdown` in `packages/web/src/parts.tsx`).

```html specimen id=reply title="A reply: heading, list, table, code"
<ol class="chat">
  <li class="reply">
    <p>Three stories in <strong>Checkout v2</strong> have no estimate yet.</p>
    <h3>What's left</h3>
    <ul>
      <li>Pay with a phone wallet on the website</li>
      <li>Save a card for next time</li>
      <li>Handle 3-D Secure challenges in the native checkout</li>
    </ul>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Story</th>
            <th>Assignee</th>
            <th>Estimate</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>SYN-23</td>
            <td>Amara Okafor</td>
            <td>—</td>
          </tr>
          <tr>
            <td>SYN-99</td>
            <td>Unassigned</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>I read them with <code>jira.search</code>:</p>
    <pre><code>const stories = await jira.search({ estimate: null });</code></pre>
    <blockquote><p>Estimates are in story points.</p></blockquote>
  </li>
</ol>
```

### A quote from an item

When the agent quotes an item (decision 0032), Oriel captions the quote itself, with the item's chip, from its own check of the words: **"Word for word from"** when it found them there (an accent rule), **"Quoted from"** when it didn't (a danger rule). While the turn still runs, or when nothing checked it, it says "Quoted from" and makes no claim (the rule stays `--line-strong`).

```html specimen id=quote-from title="Quotes from an item: found, not found, unchecked"
<ol class="chat">
  <li class="reply">
    <figure class="quote-from" data-found="true">
      <figcaption>
        Word for word from
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
        >
      </figcaption>
      <blockquote>
        <p>The wallet button shows only on devices that have a card set up.</p>
      </blockquote>
    </figure>
    <figure class="quote-from" data-found="false">
      <figcaption>
        Quoted from
        <span
          class="chip"
          data-kind="item"
          data-state="todo"
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
      </figcaption>
      <blockquote><p>Saved cards expire after a year.</p></blockquote>
    </figure>
    <figure class="quote-from">
      <figcaption>Quoted from <span class="chip" data-pending="">…</span></figcaption>
      <blockquote><p>Retry once, then ask for another card.</p></blockquote>
    </figure>
  </li>
</ol>
```

### A run

What the agent ran, in one faint line until opened: "Ran a script · 1 read · 3 changes", or "· no changes". The line leaves out what tells a person nothing: no "0 reads", and no milliseconds. Both are inside the fold, on its first line (`.run-meta`): "0 reads · 40 ms". Opened, it shows that, the script (`pre.code`, bordered), what it logged and returned (`pre.output`), and an error with its hint. A run that failed, timed out, hit a limit or was stopped turns its line `--danger`.

```html specimen id=run title="A run: folded, opened, failed, running"
<ol class="chat">
  <li>
    <details class="run" data-outcome="ok">
      <summary>Ran a script · 1 read · 3 changes</summary>
      <div class="run-body">
        <pre class="code">const stories = await jira.search({ estimate: null });</pre>
      </div>
    </details>
  </li>
  <li>
    <details class="run" data-outcome="ok" open>
      <summary>Ran a script · 1 read · no changes</summary>
      <div class="run-body">
        <p class="run-meta">1 read · 56 ms</p>
        <pre class="code">
const all = await items.list();
return all.map((item) => `${item.id}: ${item.text.length} characters`);</pre>
        <pre class="output">
[
  "jira:SYN-23: 113 characters",
  "jira:SYN-99: 238 characters"
]</pre>
      </div>
    </details>
  </li>
  <li>
    <details class="run" data-outcome="threw" open>
      <summary>Script failed · no changes</summary>
      <div class="run-body">
        <p class="run-meta">0 reads · 12 ms</p>
        <pre class="code">await jira.update("SYN-23", { points: "three" });</pre>
        <!-- prettier-ignore -->
        <p class="run-error">points must be a number<span class="hint"> Pass 3, not "three".</span></p>
      </div>
    </details>
  </li>
  <li>
    <details class="run" data-outcome="running">
      <summary>Running a script…</summary>
      <div class="run-body"><pre class="code">const all = await items.list();</pre></div>
    </details>
  </li>
</ol>
```

### Oriel's own lines

- **A marker** (`.marker`, `role="note"`): the thread's region moved to a new version of its workstream, and this is what moved: "Added SYN-900, SYN-901", "Removed SYN-12", or both joined by " · ". It's a centred faint line between two rules (the rules drop in a narrow page). The rail's title says the version it moved to: "17 items · v3". Markers the agent's own actions left just before are folded into the "What the agent did" list instead (`entriesOf` in `packages/web/src/thread.ts`).
- **A note** (`.oriel-note`, `role="note"`): after a rejection, what the person can do next (OA-91). A thick left rule, muted, small. Or Oriel's offer, when a tracker turns on, to make its own tracker's issues again there (decision 0059): "Jira is on. This change makes the 3 issues in Oriel's tracker again in Jira, and your workstreams follow them there. Approve it, and Oriel's tracker steps aside; reject it, and both stay." Its thread, "Into Jira", is Oriel's: no run of the agent's made the change set under it.
- **A notice** (`.notice`): a limit that ended the turn, on `--derived-soft` with its first sentence strong; or an error, in `--danger`.
- **What the agent did in Oriel** (`.actions-block`, decision 0024): each action the agent took on Oriel's own data, as Oriel says it, each with its Undo, or Redo once undone. A refused one is `--danger`. It's on `--surface-sunk`, boxed like a block, never in the reply's words.

```html specimen id=oriel-lines title="A marker, a note, a limit, an error"
<ol class="chat">
  <li class="marker" role="note">
    <span
      >Added
      <span
        ><a
          class="key source-link"
          href="https://synthetic.atlassian.net/browse/SYN-900"
          target="_blank"
          rel="noopener noreferrer"
          >SYN-900</a
        ></span
      ><span
        >,
        <a
          class="key source-link"
          href="https://synthetic.atlassian.net/browse/SYN-901"
          target="_blank"
          rel="noopener noreferrer"
          >SYN-901</a
        ></span
      ></span
    >
  </li>
  <li class="marker" role="note">
    <span
      >Added
      <span
        ><a
          class="key source-link"
          href="https://synthetic.atlassian.net/browse/SYN-3"
          target="_blank"
          rel="noopener noreferrer"
          >SYN-3</a
        ><span class="ref-title"> Weather disruptions and rebooking</span></span
      >
      · Removed
      <span
        ><a
          class="key source-link"
          href="https://synthetic.atlassian.net/browse/SYN-12"
          target="_blank"
          rel="noopener noreferrer"
          >SYN-12</a
        ><span class="ref-title"> Gift card balance check</span></span
      ></span
    >
  </li>
  <li class="oriel-note" role="note">
    <p>Change rejected. You can ask the agent to make changes or close the thread.</p>
  </li>
  <li class="notice" data-tone="limit" role="status">
    <strong>This thread has hit its limit, so the agent stopped here. </strong>This thread has had
    all 100 of its questions. Start a new thread on this workstream to keep going.
  </li>
  <li class="notice" data-tone="error">Stopped.</li>
</ol>
```

```html specimen id=actions title="What the agent did in Oriel, with Undo and Redo"
<ol class="chat">
  <li class="actions-block" aria-label="What the agent did in Oriel">
    <ul class="action-lines">
      <li data-applied="yes">
        <span class="action-text"
          ><a href="/workstream/gift-cards"
            >Made the workstream “Gift cards” with SYN-3, SYN-7 and SYN-9.</a
          ></span
        >
        <button type="button" class="undo-action">Undo</button>
      </li>
      <li data-applied="yes" data-undone="yes">
        <span class="action-text">Marked this thread done, which you undid.</span>
        <button type="button" class="undo-action">Redo</button>
      </li>
      <li data-applied="no">
        <span class="action-text"
          >Didn't mark this workstream done: a change set in one of its threads waits on you, so it
          stays in Needs you.</span
        >
      </li>
    </ul>
  </li>
</ol>
```

### The escape hatch

What the agent found outside the thread's workstream, through `search()` or `window.overview()`, is a rows [block](/components/block) with `data-outside`: dashed, on `--derived-soft`, labelled **"Outside this workstream · read-only"**. The agent can read it and name it; it can't change it from this thread. A reply under it usually says so.

```html specimen id=escape-hatch title="Outside this workstream · read-only"
<ol class="chat">
  <li class="user-message">Find anything about weather</li>
  <li class="reply"><p>I'll look across the whole window, not just this workstream.</p></li>
  <li>
    <figure class="answer-block" data-form="rows" data-outside>
      <p class="search-label">Outside this workstream · read-only</p>
      <ul class="block-rows">
        <li>
          <span
            class="chip"
            data-kind="item"
            data-state="in-progress"
            title="SYN-3: Weather disruptions and rebooking, in progress"
            ><a
              class="chip-link"
              href="https://synthetic.atlassian.net/browse/SYN-3"
              target="_blank"
              rel="noopener noreferrer"
              ><span class="chip-lead"
                ><svg class="chip-icon" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 8l1.8 1.8L10.5 6" /></svg
                ><span class="chip-key">SYN-3</span></span
              >
              <span class="chip-name">Weather disruptions and rebooking</span
              ><span class="chip-state">In Progress</span></a
            ></span
          >
        </li>
      </ul>
      <figcaption>Computed by Oriel from a search of everything indexed</figcaption>
    </figure>
  </li>
  <li class="reply"><p>Those come from outside this workstream, so they're read-only here.</p></li>
</ol>
```

### A held message

A message from anyone but the person (decision 0024, OA-87). The agent never sees it until the person sends it on, as it is or edited, as their own message; or they discard it. Today the only sender is someone who rejected a change set on its [review link](/components/change-set#the-review-link-page). While it waits it's the person's move, so it's **tinted and edged as theirs**: `--accent-soft`, an accent start edge, who it's from at the top, and its state chip, **Message held**. Its words are a quote. Settled, it goes back to a dashed `--line-strong` box on `--surface`.

**Edit moves the words into the composer**, the one field the person always writes in, rather than opening a second field inside the card. The card then says "Editing in the message box. Send there sends it as yours.", Cancel puts back what the composer held, and Send, in the composer or on the card, sends what's there as the held message, edited (`updateThread` in `packages/web/src/thread.ts`). Settled from another page meanwhile, the words stay in the composer as the person's own.

```html specimen id=held title="Held: waiting, editing in the composer, sent, discarded"
<ol class="chat">
  <li class="held-block" data-outcome="held">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <span><strong>Priya Shah</strong> rejected this on the review link, and wrote:</span
        ><span class="state-chip" data-waiting="held">Message held</span>
      </p>
      <!-- prettier-ignore -->
      <blockquote class="held-text">The estimate is wrong; it's 5. 3-D Secure needs the bank's test cards.</blockquote>
      <div class="held-actions">
        <button type="button" class="button primary">Send to agent</button>
        <button type="button" class="button">Edit</button>
        <button type="button" class="quiet-action">Discard</button>
        <span class="held-note">The agent won't see this until you send it.</span>
      </div>
    </section>
  </li>
  <li class="held-block" data-outcome="held">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <span><strong>Priya Shah</strong> rejected this on the review link, and wrote:</span
        ><span class="state-chip" data-waiting="held">Message held</span>
      </p>
      <blockquote class="held-text">The estimate is wrong; it's 5.</blockquote>
      <div class="held-actions">
        <button type="button" class="button primary">Send to agent</button>
        <button type="button" class="button">Cancel</button>
        <button type="button" class="quiet-action">Discard</button>
        <span class="held-note">Editing in the message box. Send there sends it as yours.</span>
      </div>
    </section>
  </li>
  <li class="held-block" data-outcome="sent">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <span><strong>Priya Shah</strong> rejected this on the review link, and wrote:</span>
      </p>
      <blockquote class="held-text">The estimate is wrong; it's 5.</blockquote>
      <p class="held-note">Sent to the agent.</p>
    </section>
  </li>
  <li class="held-block" data-outcome="discarded">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <span><strong>Dana Reyes</strong> rejected this on the review link, and wrote:</span>
      </p>
      <blockquote class="held-text">Not this sprint.</blockquote>
      <p class="held-note">Discarded. The agent never saw it.</p>
    </section>
  </li>
</ol>
```

### A draft

A draft of the agent's (decision 0051): one of the person's own actions, such as how a connection reads its source, which only they apply. It's held the same way, in `.held-message.draft-card`, but isn't tinted as a held message is: its tables and options read on `--surface`, and Oriel draws it from its own data: each option, as it is and as drafted. It's never approved and never goes through a review link: see [Approval](/patterns/approval#where-approve-is-deliberately-absent). A connector that drafts in its own form, as a spreadsheet's columns by letter, shows the source's tables instead; see [Connect steps](/patterns/connect-steps).

```html specimen id=draft title="A draft: waiting, applied, stale"
<ol class="chat">
  <li class="held-block" data-outcome="held">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <strong>The agent drafted</strong> how Jira · synthetic reads its source. Nothing changes
        until you apply it.
      </p>
      <dl class="draft-changes">
        <div>
          <dt>projects</dt>
          <dd>
            <span class="draft-was">SYN</span><span aria-hidden="true"> → </span
            ><span class="visually-hidden"> becomes </span><span>SYN, PAY</span>
          </dd>
        </div>
      </dl>
      <div class="held-actions">
        <span class="held-note">Only you can apply it.</span>
        <button type="button" class="button primary">Apply</button>
        <button type="button" class="button">Edit</button>
        <button type="button" class="quiet-action">Discard</button>
      </div>
    </section>
  </li>
  <li class="held-block" data-outcome="applied">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <strong>The agent drafted</strong> how Jira · synthetic reads its source.
      </p>
      <dl class="draft-changes">
        <div>
          <dt>projects</dt>
          <dd>
            <span class="draft-was">SYN</span><span aria-hidden="true"> → </span
            ><span class="visually-hidden"> becomes </span><span>SYN, PAY</span>
          </dd>
        </div>
      </dl>
      <div class="held-actions">
        <span class="held-note">Applied. Jira · synthetic reads this way now.</span>
        <button type="button" class="undo-action">Undo</button>
      </div>
    </section>
  </li>
  <li class="held-block" data-outcome="stale">
    <section class="held-message" aria-busy="false">
      <p class="held-by">
        <strong>The agent drafted</strong> how Jira · synthetic reads its source.
      </p>
      <dl class="draft-changes">
        <div>
          <dt>projects</dt>
          <dd>
            <span class="draft-was">SYN</span><span aria-hidden="true"> → </span
            ><span class="visually-hidden"> becomes </span><span>SYN, PAY</span>
          </dd>
        </div>
      </dl>
      <div class="held-actions">
        <span class="held-note"
          >Jira · synthetic's options changed since this was drafted, so it can't apply.</span
        >
        <button type="button" class="quiet-action">Discard</button>
      </div>
    </section>
  </li>
</ol>
```

The drafted value is `<span class="draft-to">` in the app (`DraftCard` in `packages/web/src/thread-page.tsx`); that class has no rules, so it's left off here.

### Continue in…

The window chat changes no item (decision 0062). Asked to change one, the agent drafts Continue in…, and the chat shows it as **one button** under its one-line reply: "Continue in" the workstream that holds the item, or "a new workstream", named for it, when none does. No note or caption explains it: the button is the guidance. Pressed, the request goes on in a thread there, sent as the person's, and the page opens it; the button becomes a quiet link to that thread.

In the thread it lands in, the request is a held message from the window chat, already sent, so only **where it came from** shows, in `p.held-from` over the person's message, linking back to the chat.

```html specimen id=continue title="Continue in…: offered, pressed, and where it landed"
<ol class="chat">
  <li class="reply"><p>Its workstream can change it.</p></li>
  <li class="continue-block">
    <button type="button" class="button primary">Continue in a new workstream</button>
  </li>
  <li class="continue-block">
    <a class="quiet-action" href="#">Continued in Weather disruptions ›</a>
  </li>
  <li class="held-block" data-outcome="sent">
    <p class="held-from"><a href="#">From the window chat</a></p>
  </li>
</ol>
```

### The window chat's head

The window chat draws its entries with the same renderer, in its own rail at the window's right (`aside.window-chat`, named "The window chat", `--chat-rail` wide, on `--frame`; see [Right rail](/components/right-rail#the-window-chat-s-rail)). Its head (`.window-chat-head`) is one `--head-row` line: the title, **Chat** (`h2.rail-title.window-chat-title`, small caps and faint as a thread's rail's title, taking the room), then **Open as a thread** once there's a chat to open, **New chat**, and the fold, **Hide the chat**: the sidebar's fold button with its icon mirrored (see [Icon button](/components/icon-button)). Hiding it puts the composer back at the page's foot, with its draft, and Back to the chat.

**Open as a thread** hands the chat over: it makes the window chat its workstream's ordinary thread (`POST /api/window-chat/open`), folds the rail and goes to the thread, and the window shows a fresh chat after. It isn't **Continue in…** (SPEC §2, decision 0027), which carries the conversation to a workstream the person picks, as a held message. The entries follow in `ol.chat.window-chat-entries`, which scrolls; its composer is on [Chat input](/components/chat-input).

```html specimen id=window-chat-head title="The window chat, before the first question" width=390 height=260
<aside class="window-chat" aria-label="The window chat">
  <header class="window-chat-head">
    <h2 class="rail-title window-chat-title">Chat</h2>
    <button type="button" class="quiet-action" disabled>New chat</button>
    <button type="button" class="sidebar-fold window-chat-fold" aria-label="Hide the chat">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M10 2.5v11" />
      </svg>
    </button>
  </header>
  <ol class="chat window-chat-entries">
    <li class="window-chat-empty">
      Ask about what changed, what needs you, or what should become a workstream.
    </li>
  </ol>
</aside>
```

```html specimen id=window-chat-head-open title="With a chat: Open as a thread, and New chat live" width=390 height=120
<aside class="window-chat" aria-label="The window chat">
  <header class="window-chat-head">
    <h2 class="rail-title window-chat-title">Chat</h2>
    <a href="/threads/t-41" class="quiet-action">Open as a thread</a>
    <button type="button" class="quiet-action">New chat</button>
    <button type="button" class="sidebar-fold window-chat-fold" aria-label="Hide the chat">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M10 2.5v11" />
      </svg>
    </button>
  </header>
</aside>
```

### Moved into its workstream

Once the window chat's own workstream gains a member, as when the agent adds items to it or a plan's change set applies there, the chat is that workstream's thread (decision 0030, OA-347). The conversation stays in the rail, and its last entry says where it went (`li.window-chat-moved`, muted, ruled above): "Now a thread in" and the workstream's name, a link to the thread. The composer below is a fresh chat's at once ("Ask about your window"), and the next question starts it; words typed before the move stay in it.

```html specimen id=window-chat-moved title="Moved: the conversation stays, with where it went" width=390 height=300
<aside class="window-chat" aria-label="The window chat">
  <header class="window-chat-head">
    <h2 class="rail-title window-chat-title">Chat</h2>
    <a href="/threads/t-41" class="quiet-action">Open as a thread</a>
    <button type="button" class="quiet-action">New chat</button>
    <button type="button" class="sidebar-fold window-chat-fold" aria-label="Hide the chat">
      <svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="12" height="11" rx="2" />
        <path d="M10 2.5v11" />
      </svg>
    </button>
  </header>
  <ol class="chat window-chat-entries">
    <li class="user-message">Make a workstream for the gift card stories.</li>
    <li class="reply"><p>I've added SYN-41, SYN-44 and SYN-52 to Gift cards.</p></li>
    <li class="window-chat-moved">Now a thread in <a href="/threads/t-41">Gift cards</a></li>
  </ol>
</aside>
```

## States

```html specimen id=state-working title="Working: the agent is answering" state=busy
<ol class="chat">
  <li class="user-message">Which stories here still need estimates?</li>
  <li class="working" role="status"><span class="working-dot"></span> Working…</li>
</ol>
```

```html specimen id=state-focus title="Focus: a run's line, a chip in a quote" state=focus-visible
<ol class="chat">
  <li>
    <details class="run" data-outcome="ok">
      <summary class="ws-focus-visible">Ran a script · 1 read · 3 changes</summary>
      <div class="run-body">
        <pre class="code">const stories = await jira.search({ estimate: null });</pre>
      </div>
    </details>
  </li>
  <li>
    <details class="run" data-outcome="ok">
      <summary class="ws-hover">Ran a script · 2 reads · no changes</summary>
      <div class="run-body"><pre class="code">await items.list();</pre></div>
    </details>
  </li>
</ol>
```

- **Rest** is every specimen above.
- **Hover** is styled on a run's line (`--surface-hover`, its text to muted), a chip's name (its underline turns `currentColor`), the crumb, and the buttons inside entries. The person's message and the reply have no hover.
- **Focus-visible** is the global ring on every link, button and summary. Entries themselves don't take focus; the thread's title does (`tabindex="-1"`), when the page opens.
- **Active** isn't styled.
- **Disabled:** a held message's and a draft's buttons are disabled while they settle, and the section sets `aria-busy`. Send to agent is also disabled while the agent runs, and when the edit is blank. An Undo in "What the agent did" is disabled while it undoes, and faint (`.action-lines .undo-action:disabled` in `window.css`).
- **Busy:** "Working…" is the last entry while the agent runs, with the one pulsing dot (`.working .working-dot` in `window.css`); the thread sets `aria-busy="true"` on `main.thread`. A run that's still going says "Running a script…".
- **Error:** a turn that failed ends with a `.notice[data-tone="error"]` entry, in the server's words. A limit ends it with `.notice[data-tone="limit"]`. A run that failed turns its line red and shows its error inside.
- **Empty:** a new thread's chat is empty; the composer's placeholder invites a plan ("What are you planning? Describe it, and ask for an epic and its stories…"). The window chat's empty line is `.window-chat-empty`: "Ask about what changed, what needs you, or what should become a workstream."
- **Settled:** a held message reads "Sent to the agent." or "Discarded. The agent never saw it." (discarded strikes its quote through); a draft reads "Applied. {name} reads this way now." with Undo, or "Discarded.", and a stale or discarded draft fades its options to faint.

## Keyboard and ARIA

- The chat is an `<ol>`: a screen reader hears how many entries there are and where it is.
- `.working` is `role="status"`, so "Working…" is announced when the agent starts. The limit notice is `role="status"`; a marker and a note are `role="note"`.
- A run is a native `<details>`: Enter or Space opens it.
- The action list is an `<li>` named "What the agent did in Oriel" (`aria-label`), so it's never read as the agent's words.
- In a diff value or a marker, an item's key is a link (`.key.source-link`) that opens the item in the panel; with ⌘ or a middle click it opens in its source.
- A held message's Edit moves focus to the composer, which then holds its words. After a rejection, focus moves to the composer, so the person can say what was wrong (`perform` in `packages/web/src/effects.ts`).
- A sketch's frame is titled "A sketch by the agent"; see [Block](/components/block#sketch).

## Content

- The agent's words are the agent's. Oriel never edits a reply, and never puts its own sentences in one.
- Oriel's lines are plain and short, and say what happened, not what the agent "thinks": "Change rejected. You can ask the agent to make changes or close the thread." / "Change rejected on its review link."
- A marker names items by key and, when it has one, title: "Added SYN-3 Weather disruptions and rebooking · Removed SYN-12".
- A run's line is counts, joined with " · ": "Ran a script · 1 read · 3 changes", with no "0 reads" and no milliseconds, which are inside the fold. Not run: "Running a script…"; failed: "Script failed", "Script timed out", "Script hit a limit"; cut off: "Script stopped before it finished".
- Busy is "Working…" (with U+2026), never "Thinking…" or "Loading…".
- A held message says who and how: "**Priya Shah** rejected this on the review link:", then "The agent won't see this until you send it." Its button is **Send to agent**.
- A draft says whose and what: "**The agent drafted** how Jira · synthetic reads its source. Nothing changes until you apply it." then "Only you can apply it." Its button is **Apply**, never Approve.

## Where the app uses it

- `ChatEntryItem` in `packages/web/src/thread-page.tsx`. The thread page's chat and Working…: `ThreadPage` in `packages/web/src/thread-page.tsx`. The window chat's, with its head: `WindowChat` in `packages/web/src/window-chat-view.tsx`; CSS `.window-chat-head`, `.window-chat-title` and `.window-chat-moved` in `window.css`; whether it moved, `movedOut` in `packages/web/src/window-chat.ts`.
- The thread's head: `ThreadPage` in `packages/web/src/thread-page.tsx`. CSS: `.thread-layout` and `.thread` in `window.css`; the head, `.thread-head`, `.crumb`, `.thread-title-row`, `.thread-title` and `.thread-title-row .quiet-action` in `window.css`.
- `.chat` and `.user-message` in `window.css`, and `.user-message .about`, the line `ChatEntryItem` in `packages/web/src/thread-page.tsx` draws for what a message was about. `.reply` and its markdown: `.reply`, `.reply :is(p, ul, ol, blockquote, pre, hr)`, `.reply :is(h3, h4, h5, h6)`, `.reply :is(ul, ol)`, `.reply blockquote`, `.reply code`, `.reply pre`, `.reply a`, `.reply hr`, `.table-scroll` and `.reply table` in `window.css`; `Markdown` in `packages/web/src/parts.tsx`, its tables drawn by `block` in `packages/web/src/parts.tsx`.
- `.quote-from`: `QuoteFrom` in `packages/web/src/parts.tsx`; CSS `.reply .quote-from` in `window.css`.
- `.marker`: `ChatEntryItem` in `packages/web/src/thread-page.tsx`; CSS `.marker` in `window.css`, and `.marker::before` in `window.css` hides its rules when narrow.
- `.run`: `Run` in `packages/web/src/thread-page.tsx`; CSS `.run`, `.run summary`, `.run[data-outcome="threw"] summary`, `.run-body`, `.code`, `.run-error` and `.hint` in `window.css`.
- `.working` and `.working-dot` in `window.css`.
- `.actions-block`: `ActionLines` in `packages/web/src/thread-page.tsx`; CSS `.actions-block`, `.action-lines`, `.action-lines li`, `.action-lines li[data-undone="yes"] .action-text`, `.action-lines .undo-action`, `.action-lines .undo-action:disabled`, `.action-lines li[data-applied="no"]` and `.action-lines a` in `window.css`.
- `.oriel-note`: `OrielNote` in `packages/web/src/thread-page.tsx`; CSS `.oriel-note` in `window.css`.
- `.notice`: `ChatEntryItem` in `packages/web/src/thread-page.tsx`; CSS `.notice` in `window.css`.
- `.held-message`: `HeldMessage` in `packages/web/src/thread-page.tsx`; CSS `.held-message`, `.held-by`, `.held-text`, `.held-block[data-outcome="discarded"] .held-text`, `.held-block[data-outcome="held"] > .held-message:not(.draft-card)`, `.held-actions` and `.held-note` in `window.css`. A draft's option fields are `.held-field`.
- The draft: `DraftCard` in `packages/web/src/thread-page.tsx`; `.draft-changes` in `window.css`.
