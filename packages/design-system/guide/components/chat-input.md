---
title: Chat input
status: stable
group: Inputs
order: 20
classes: ask, chat-input, chat-input-field, chat-input-foot, chat-input-reads, chat-input-notice, ask-starts-head, ask-questions, ask-question, chat-dock, workstream-ask, ctx, ctx-chip, ctx-label, ctx-name, ctx-x, ctx-action
summary: Where a person asks the agent: one ChatInput for the overview's ask bar, the window chat, a thread's composer and a workstream's Ask box, with the same frame, focus, problem line and foot.
---

# Chat input

## What it is

The field a person asks the agent in, with its button. It's where "point, don't prompt" turns into a question, so it's the most-used control in Oriel. One component, `ChatInput`, draws it in every place (DRIFT D3, done):

1. **The ask bar** on the overview (decision 0030): one line, "Ask about your window", with questions to start from under it.
2. **The window chat's composer**: its first ask, and its follow-ups once there's an answer.
3. **A thread's composer**: in a dock at the foot of the thread.
4. **A workstream's Ask box**: on the workstream's page. It starts a thread.

Every one has the same frame, the same focus ring, the same problem line and the same foot: on the left, what the agent will read; on the right, the button. The send key isn't shown: Settings › Send says which it is.

## When to use it

- Wherever the person asks the agent something: a thread, the window chat, a workstream, the overview. Import `ChatInput` from `packages/web/src/chat-input.tsx`; never copy it.
- Use the **one-line, large** shape (`lines="one" size="lg" marked`) only for the overview's ask bar. Decision 0041 says "the ask bar is one line, so Enter always asks there".
- Use the **growing** shape everywhere else. It follows Settings' send key (Enter, or ⌘Enter), read from `SendKeyContext` in `packages/web/src/parts.tsx`.
- Raise it (`elevation="raised"`) only where it floats over a thread, in the thread's dock.

## When not to

- Not for a field in a form, such as a draft's option or the review link's note. Those are [text fields](/components/text-field): they save, they don't ask. A held message's words aren't edited in a field of their own either: Edit moves them into the composer.
- Not for search. The sidebar's and Browse's searches filter what's on the page; they never reach the agent. See [Text field](/components/text-field#search).
- Not with a second submit button beside it. Stop replaces Send while the agent runs; it doesn't sit next to it.

## Anatomy and variants

A frame holding the field, then its foot, then at most one line for a problem.

- **Frame** (`.chat-input`): `--border-thin` in `--line-strong`, `--radius-lg`, on `--surface`. In a thread it floats, with `--shadow`.
- **Field** (`.chat-input-field`): a `<textarea rows="2">` that grows to 12rem (`field-sizing: content`), or one `<input>` for the ask bar. The app keeps `ask-input` on the ask bar's input, with no rules, for shots to find it.
- **Foot** (`.chat-input-foot`): what the agent will read (`.chat-input-reads`, with the epic mark), anything beside it (Back to the chat), and the button. No send key: it's in Settings › Send, and repeated on the box it only made it busy.
- **Button:** "Ask" where a question starts something (the ask bar, a workstream), "Send" in a conversation. A plain `.button` until something is written, and only then `.button.primary`: the accent means it's the person's move, and an empty field isn't one.
- **Stop:** a `.button` in Send's place while the agent runs.
- **Notice** (`.chat-input-notice`): one `role="alert"` line in `--danger`, inside the frame.
- **Dock** (`.chat-dock`): a thread's composer sits in it. It sticks at the thread's foot and fades from the page's colour over what scrolls under it, and writes `--dock-cover` on the thread, so a change set's actions can stick just above it.

```html specimen id=ask-bar title="The ask bar (overview), one line, marked"
<section class="ask" aria-label="Ask about your window">
  <form class="chat-input" data-lines="one" data-size="lg" data-marked>
    <input
      type="text"
      class="chat-input-field"
      placeholder="Ask about your window"
      aria-label="Ask about your window"
    />
    <div class="chat-input-foot">
      <span class="chat-input-reads">Reads your whole window</span>
      <button type="submit" class="button" disabled>Ask</button>
    </div>
  </form>
  <h2 class="ask-starts-head" id="starts-head">Questions to start from</h2>
  <ul class="ask-questions" aria-labelledby="starts-head">
    <li>
      <button type="button" class="ask-question">
        Should Vehicle and freight reservations become a workstream?
      </button>
    </li>
    <li>
      <button type="button" class="ask-question">What moved in Checkout v2 this week?</button>
    </li>
  </ul>
</section>
```

```html specimen id=composer title="A thread's composer, raised, in its dock"
<div class="chat-dock">
  <form class="chat-input" data-lines="grow" data-elevation="raised">
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
```

```html specimen id=workstream title="A workstream's Ask box, flat"
<form class="chat-input workstream-ask" data-lines="grow">
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about these 6 items…"
    aria-label="Ask about this workstream"
  ></textarea>
  <div class="chat-input-foot">
    <span class="chat-input-reads">Reads 6 items · v2</span>
    <button type="submit" class="button" disabled>Ask</button>
  </div>
</form>
```

## What it's about (Looking at)

Over the field, the composer offers the item open beside it as what the next message is about (decision 0062): `LookingChips` in `packages/web/src/chat-input.tsx`, in the `context` slot. Sent, the message keeps the item by ID, and the agent reads it in a tool result. Looking adds nothing to the workstream: that's a cite's.

- **Offered** (`.ctx-chip`): "Looking at", the item's key and title, and × (`.ctx-x`) to leave it out. The foot adds it: "Reads 17 items · v3, and SYN-99".
- **Not sending** (`.ctx-chip[data-off]`): dashed, with Add back (`.ctx-action`) beside it.
- **A second item:** with words typed, opening another item keeps the draft's own and offers the new one dashed, as a button: "+ SYN-104". + adds it. With the field empty, opening another item swaps the chip.
- **Read-only:** in a thread, an item outside its region says "· read-only", and Cite beside it adds it to the workstream, with its Undo. The window chat reads every item as the window does, so it never says read-only.
- Closing the item takes its chip only while nothing is typed.

```html specimen id=looking title="Looking at: offered, and a second item while typing"
<form class="chat-input" data-lines="grow">
  <div class="ctx" role="group" aria-label="What your message is about">
    <span class="ctx-chip"
      ><span class="ctx-label">Looking at</span
      ><span class="ctx-name"><b>SYN-99</b> Save a card for next time</span
      ><button type="button" class="ctx-x" aria-label="Leave SYN-99 out">×</button></span
    >
    <button
      type="button"
      class="ctx-chip"
      data-off
      aria-label="Add SYN-104 to what your message is about"
    >
      <span class="ctx-label">+</span
      ><span class="ctx-name"><b>SYN-104</b> Handle 3-D Secure challenges</span>
    </button>
  </div>
  <textarea class="chat-input-field" rows="2" aria-label="Message">Is this blocked on</textarea>
  <div class="chat-input-foot">
    <span class="chat-input-reads">Reads 17 items · v3, and SYN-99</span>
    <button type="submit" class="button primary">Send</button>
  </div>
</form>
```

```html specimen id=looking-off title="Not sending, and read-only with Cite"
<form class="chat-input" data-lines="grow">
  <div class="ctx" role="group" aria-label="What your message is about">
    <span class="ctx-chip" data-off
      ><span class="ctx-label">Not sending</span
      ><span class="ctx-name"><b>SYN-99</b> Save a card for next time</span></span
    >
    <button type="button" class="quiet-action ctx-action">Add back</button>
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
<form class="chat-input" data-lines="grow">
  <div class="ctx" role="group" aria-label="What your message is about">
    <span class="ctx-chip"
      ><span class="ctx-label">Looking at</span
      ><span class="ctx-name"><b>SYN-54</b> Cancellation alert sent for a sailing</span
      ><span class="ctx-label">· read-only</span
      ><button type="button" class="ctx-x" aria-label="Leave SYN-54 out">×</button></span
    >
    <button type="button" class="quiet-action ctx-action">Cite</button>
  </div>
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about 17 items…"
    aria-label="Message"
  ></textarea>
  <div class="chat-input-foot">
    <span class="chat-input-reads">Reads 17 items · v3, and SYN-54 (read-only)</span>
    <button type="submit" class="button" disabled>Send</button>
  </div>
</form>
```

## States

Focus is forced in the first specimen (`.ws-focus-within` carries window.css's own `:focus-within` rule). Click into any of them to see the real thing.

```html specimen id=state-focus title="Focus: one frame ring, in --focus, with something written" state=focus
<form class="chat-input ws-focus-within" data-lines="grow">
  <textarea class="chat-input-field" rows="2" aria-label="Message">
Estimate SYN-23 and SYN-104 like SYN-92</textarea>
  <div class="chat-input-foot">
    <span class="chat-input-reads">Reads 17 items · v3</span>
    <button type="submit" class="button primary">Send</button>
  </div>
</form>
```

```html specimen id=state-running title="Busy: the agent is working, and Stop replaces Send" state=busy
<ol class="chat">
  <li class="working" role="status"><span class="working-dot"></span> Working…</li>
</ol>
<form class="chat-input" data-lines="grow">
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about 17 items…"
    aria-label="Message"
  ></textarea>
  <div class="chat-input-foot">
    <span class="chat-input-reads">Reads 17 items · v3</span>
    <button type="button" class="button">Stop</button>
  </div>
</form>
```

```html specimen id=state-error title="Error: one line, inside the frame" state=error
<form class="chat-input" data-lines="grow">
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
  <p class="chat-input-notice" role="alert">
    Claude Code stopped before it answered. Send again to retry.
  </p>
</form>
```

```html specimen id=state-off title="Off: no AI set up (decision 0038)" state=disabled
<section class="ask" aria-label="Ask about your window">
  <div class="chat-input" data-lines="one" data-size="lg" data-marked data-off>
    <input
      type="text"
      class="chat-input-field"
      disabled
      placeholder="Set up Claude to ask about your window"
      aria-label="Set up Claude to ask about your window"
    />
    <a href="/settings" class="button primary">Set up</a>
  </div>
</section>
```

- **Rest:** placeholder in the field, the button plain and disabled until something is written (and not only spaces): `sendable` in `packages/web/src/settings.ts`.
- **Hover:** nothing; the frame doesn't change under the pointer.
- **Focus:** one ring on the frame, its border and a 1px ring in `--focus`, on `:focus-within`. The field inside has no outline.
- **Active:** not styled.
- **Disabled:** the button is disabled while the draft is blank or a send is under way. The field itself is never disabled, except with no AI set up ("off").
- **Filled:** the button turns primary.
- **Busy:** "Working…" shows in the conversation above, and Stop replaces Send where the agent can be stopped (a thread, the window chat). The ask bar and the Ask box have no Stop.
- **Error:** one line, `.chat-input-notice`, everywhere. The window chat shows its own problem or its thread's, never both.
- **Empty:** the window chat says what to ask about: "Ask about what changed, what needs you, or what should become a workstream."

## Keyboard and ARIA

- **Growing shape:** Settings' send key decides. With "Enter", Enter sends and Shift+Enter makes a new line; with "⌘Enter", ⌘Enter (Ctrl+Enter) sends and Enter makes a new line. An IME composition never sends. The handler is `sends` in `packages/web/src/settings.ts`.
- **One-line shape:** a form with one `<input>`, so Enter always submits (decision 0041).
- The keyboard path skips the button's `disabled`, so the reducer guards an empty or busy send (`updateThread` in `packages/web/src/thread.ts`). Keep that guard in the reducer.
- The field's accessible name is its `aria-label`: "Ask about your window", "Message", "Ask about this workstream". No chat input has a visible `<label>`; its placeholder and place say what it's for. Don't make the name the placeholder's exact words where the placeholder carries a count.
- The notice is `role="alert"`, so it's read out when it appears.
- After a rejection, and after Edit on a held message, focus goes to the composer (`perform` in `packages/web/src/effects.ts`).

## Content

- Placeholders say what the question is about, never how to ask: "Ask about your window", "Ask about 17 items…", "Ask a follow-up". Use the count of items, from `askPrompt` in `packages/web/src/workstream.ts`.
- Where there's nothing to ask about yet, the placeholder invites a plan: "What are you planning? Describe it, and ask for an epic and its stories…".
- The foot says what the agent will read, in Oriel's own counts: "Reads 17 items · v3", "Reads your whole window". A thread behind its workstream says "Reads its workstream at v4", which the next message catches up with (`readsOf` in `packages/web/src/thread-page.tsx`). A thread with no items says nothing.
- The button says **Ask** where a question starts something, **Send** inside a conversation.
- A problem says what happened and what to do: "Claude Code stopped before it answered. Send again to retry." Not "Error" or "Something went wrong".
- Questions to start from are whole questions in sentence case, about the person's own workstreams, as rows under "Questions to start from": "What moved in Payments?", "Why is Checkout v2 stalled?".

## Where the app uses it

- The component: `ChatInput` in `packages/web/src/chat-input.tsx`. CSS `.chat-input`, `.chat-input-field`, `.chat-input-foot`, `.chat-input-reads`, `.chat-input-notice` and `.chat-input[data-off]` in `window.css`.
- The ask bar: `AskBar` in `packages/web/src/window-chat-view.tsx`, mounted on the overview by `OverviewPage` in `packages/web/src/overview-page.tsx`. Its questions: `.ask-starts-head`, `.ask-questions` and `.ask-question` in `window.css`.
- The window chat's two composers: `WindowChat` in `packages/web/src/window-chat-view.tsx`, which imports only `ChatInput` for them, with its props from `windowChatComposer`.
- In the item panel's dock, below 1100px: the conversation under the item hands its composer's props (`Composer` in `packages/web/src/chat-input.tsx`, from `windowChatComposer` or `threadComposer`) to `PanelDock` in `packages/web/src/item-panel.tsx`, which draws the same `ChatInput`, flat. See [Item panel](/components/item-panel#the-dock-over-a-conversation-below-1100px).
- The thread composer: `ThreadPage` and `NewThreadPage` in `packages/web/src/thread-page.tsx`, inside `Dock`, with the thread's props from `threadComposer`. While the item panel's dock carries it, `Dock` is `inert` and hidden. CSS `.chat-dock` in `window.css`. `composer` stays on the frame as a placement hook: the pill for a change set out of view (`ToReview`) and `focusComposer` find it.
- The workstream's Ask box: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`, with `.workstream-ask` for its margin.
- What a message is about: `LookingChips` and `readsWith` in `packages/web/src/chat-input.tsx`, fed by `lookedAt` in `packages/web/src/looking.ts`, which `update` in `packages/web/src/root.ts` runs against the open panel. CSS `.ctx`, `.ctx-chip`, `.ctx-label`, `.ctx-name`, `.ctx-x` and `.ctx-action` in `window.css`.
