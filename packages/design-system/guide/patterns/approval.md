---
title: Approval
order: 10
summary: The human-in-the-loop moment. The agent proposes a change set; only a person approves it, in the thread or on a review link, and nothing is written to a source until they do.
---

# Approval

## The problem

Oriel's agent can read everything in the window and change a lot of it. Some of what it changes is Oriel's own data: which items a workstream holds, a thread marked done. Some of it is someone else's system: a story's estimate in Jira, a message in a channel. A mistake in the first is a click to undo. A mistake in the second lands in front of the team, and Oriel can't always take it back.

So Oriel draws a line, and the whole interface keeps to it: **"No approve, no write, ever"** (SPEC §1, idea 2; decision 0003).

## The pattern

There are two kinds of change, and they look different on purpose.

| What changes                                                            | Who decides                              | What the person sees                                                        | Taken back by                            |
| ----------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| **Oriel's own data**: workstreams, their items, threads (decision 0024) | the agent may do it directly             | a line under the reply saying what Oriel did, with **Undo**                 | Undo, or Redo once undone                |
| **A source**: Jira, a channel, a sheet                                  | only a person, by approving a change set | a [change set](/components/change-set): the diff, and **Approve and apply** | Revert, which is a change set of its own |

The approval moment, in order:

1. **The agent proposes.** Its reply says what it wants and why, and the change set follows as its own entry: "Proposed change", "Awaiting review". The thread's state turns to **Needs review**, and the thread joins Needs you in the [sidebar](/components/sidebar).
2. **The person reads the diff.** Every change, field by field, as it will be written: the old value struck through, the new one marked, only the changed words highlighted. They can leave any change out (×) before deciding. Approve and Reject stay disabled until the diff has loaded, because approving sends the diff's hash: **the person approves exactly what they were shown**, and the server refuses a stale one.
3. **They decide.**
   - **Approve and apply** (the one primary action): the card dims and says "Applying…" at once, then "Applied", each line ticked.
   - **Reject**: one click, no confirm. The set folds to its head, Oriel says "Change rejected. You can ask the agent to make changes or close the thread.", and focus moves to the composer, where they say what was wrong.
   - **Share review link**: for someone outside Oriel to decide (below).
4. **If it doesn't all go through**, the card says exactly which change stopped and why, and offers **Try again**, **Remove this change**, **Dismiss** or **Revert what was applied**. If the source stops answering mid-apply, it says "Apply stalled" and lists what may already be in the source before it lets the person dismiss it.
5. **To take it back**, Revert proposes the reverse as a new change set, headed "Undo", nested under the first and approved the same way. A write to a source is never undone in one click.

### The accent means "your move"

In every theme the accent is the person's next move (decision 0034). On a thread with a change set, the accent is on **Approve and apply** and nowhere else in the card. The thread's state chip, "Needs review", carries it in the sidebar. Nothing the agent writes can be drawn in it: a sketch's frame is given a theme without the accent, state and button tokens, so it can't draw an exact Approve (decision 0033).

```html specimen id=moment title="The moment: the reply, Oriel's own actions, and the change set"
<ol class="chat">
  <li class="user-message">Plan gift cards in Checkout v2</li>
  <li class="reply">
    <p>
      I've made a workstream for gift cards and proposed two stories in Jira. Nothing is written
      there until you approve it.
    </p>
  </li>
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
    </ul>
  </li>
  <li>
    <section class="change-set" data-status="open" aria-busy="false" tabindex="-1">
      <header class="change-set-head">
        <h2>Proposed change</h2>
        <span class="change-set-status" role="status">Awaiting review</span>
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
        <li class="diff-line" data-kind="create">
          <p class="line-head">
            <span class="line-mark" data-kind="create">New story</span
            ><span class="new-title">Show the gift card balance at checkout</span>
          </p>
        </li>
      </ul>
      <footer class="change-set-actions">
        <button type="button" class="button primary">Approve and apply</button>
        <button type="button" class="button">Reject</button>
        <button type="button" class="quiet-action">Share review link</button>
      </footer>
    </section>
  </li>
</ol>
```

The workstream was made at once, and says so with Undo. The stories in Jira wait for a person.

### Through a review link

Someone who doesn't use Oriel (a lead, a stakeholder in a chat app) can decide through a review link. **Share review link** makes one; the card shows it in a read-only field with **Copy**. Its page is one card with no sidebar and no thread, and nothing opens until the person asks, since chat apps fetch links to preview them.

- The link can **approve, approve the rest, reject or dismiss**. Retry, remove and revert stay in the thread.
- The person types their name; the decision shows in the thread as "Applied by Priya Shah via review link".
- A reason for rejecting is optional. It **doesn't reach the agent**: it's held in the thread as a [held message](/components/message#a-held-message), "**Priya Shah** rejected this on the review link:", with **Send to agent**, **Edit** and **Discard**. The page tells the reviewer: "What you said is in the thread for whoever shared this link. They decide whether the agent sees it."

```html specimen id=review-link title="The review link's page, open" width=640
<main class="review">
  <header class="review-head">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" />
      <path d="M2.5 8.5h15M10 8.5v9" /></svg
    ><span>Oriel</span>
  </header>
  <section class="review-card">
    <h1 class="page-title">Review this change</h1>
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
    <form class="review-decide">
      <label class="name-field reason"
        >If you reject it, what's wrong? (optional)<textarea rows="2" maxlength="2000"></textarea>
      </label>
      <label class="name-field">Your name<input maxlength="120" autocomplete="name" /></label>
      <div class="review-actions">
        <button type="submit" class="button primary">Approve</button>
        <button type="button" class="button">Reject</button>
      </div>
    </form>
    <p class="read-only-note" role="status"></p>
  </section>
</main>
```

The review page's primary says **Approve**, the thread's **Approve and apply**, for the same step (`ReviewChange` in `packages/web/src/other-pages.tsx`). Copy the thread's: see the [change set's drift](/components/change-set#drift).

## Do

- Put every write to a source in a change set, whoever asked for it.
- Show the whole change, field by field, before anyone can approve it. Approve the diff the person saw, by its hash.
- Make **Approve and apply** the only primary in the card, and say what it does: it applies.
- Let the person narrow the change (Leave this change out) instead of rejecting it all.
- Show applying at once (the card dims and its status says "Applying…"), and say exactly what happened after: which changes went through, which stopped, and why.
- Let the agent act directly on Oriel's own data, and list what it did under its reply, each with Undo.
- Hold anything that reaches the agent from outside (a review link's reason) for the person to send on.

## Don't

- Don't put Approve anywhere the agent's content is drawn: not in a reply, a block or a sketch.
- Don't add a confirm to Approve or Reject. The diff is the confirmation; Reject is one click and the thread asks what was wrong.
- Don't call a draft or a held message an approval. A draft of a connection's options is **Apply**, the person's own action (decision 0051); a held message is **Send to agent**. Neither goes through a review link.
- Don't undo a write to a source in one click. Revert is a change set, reviewed like any other.
- Don't use the accent for anything else in the card. It means "your move".

## Where Oriel does it

- The change set and its steps: `ChangeSet` in `packages/web/src/thread-page.tsx`; the steps the engine offers, in order, `changeSetsOver` in `packages/changeset/src/change-sets.ts`; their labels, `stepLabel` in `packages/web/src/thread.ts`.
- Showing the decision before the server answers: `expected` in `packages/web/src/thread.ts`. The hash sent with a decision: `updateThread` in `packages/web/src/thread.ts`.
- After a rejection: Oriel's note, `OrielNote` in `packages/web/src/thread-page.tsx`; focus to the composer, `perform` in `packages/web/src/effects.ts`.
- What the agent did directly, with Undo: `ActionLines` in `packages/web/src/thread-page.tsx`.
- The review link's page: `ReviewPage` in `packages/web/src/other-pages.tsx`; the steps a link can take, `ReviewStep` in `packages/web/src/review.ts`. The held reason: `HeldMessage` in `packages/web/src/thread-page.tsx`.
- After you approve (Settings › General): "Stay on this thread" or "Go to the next thing that needs you", which moves on and says "You approved “{title}”. Applying…" with **Back** in [the bead](/components/bead), Applied once the apply is done (`approvedText` in `packages/web/src/approved.ts`).

### Where Approve is deliberately absent

- **Sketches** have no scripts, links or forms; a drawn button is a picture, and its caption says "Sketched by the agent · not checked against Oriel's data" ([Block](/components/block#sketch)).
- **Drafts** are applied, never approved, never through a review link ([Thread messages](/components/message#a-draft)).
- **Held messages** are sent, as the person's own words.
- **Oriel's own data** is changed directly, with Undo.
