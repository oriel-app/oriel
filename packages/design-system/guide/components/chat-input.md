---
title: Chat input
status: drifting
group: Inputs
order: 20
classes: ask, ask-bar, ask-input, ask-questions, ask-question, ask-problem, composer, composer-notice, chat-input, chat-input-field, chat-input-notice
summary: Where a person asks: the overview's ask bar, the window chat, a thread's composer and a workstream's Ask box. Four versions today; one ChatInput proposed.
---

# Chat input

## What it is

The field a person asks in, with its submit button. It's where "point, don't prompt" turns into a question, so it's the most-used control in Oriel. There are four of them today:

1. **The ask bar** on the overview (decision 0030): one line, "Ask about your window", with questions to start from under it.
2. **The window chat's composer**: the panel the ask bar opens, "Ask a follow-up".
3. **A thread's composer**: sticky at the foot of the thread, "Ask about 17 items…".
4. **A workstream's Ask box**: on the workstream's page, "Ask about these 6 items…". It starts a thread.

They do one job and look like three different controls. The proposal below makes them one `ChatInput` with two shapes (one line, or growing) and two sizes.

## When to use it

- Wherever the person asks the agent something: a thread, the window chat, a workstream, the overview.
- Use the **one-line, large** shape only for the overview's ask bar. Decision 0041 says "the ask bar is one line, so Enter always asks there".
- Use the **growing** shape everywhere else. It follows Settings' send key (Enter, or ⌘Enter), read from `SendKeyContext` in `packages/web/src/parts.tsx`.

## When not to

- Not for a field in a form, such as a draft's option, a held message's edit or the review link's reason. Those are [text fields](/components/text-field): they save, they don't ask.
- Not for search. The sidebar's and Browse's searches filter what's on the page; they never reach the agent. See [Text field](/components/text-field#search).
- Not with a second submit button beside it. Stop replaces Send while the agent runs; it doesn't sit next to it.

## Anatomy and variants

A frame holding the field and its submit button, then at most one line under them for a problem.

- **Frame:** `--border-thin` in `--line-strong`, `--radius-lg`, on `--surface`. In a thread it floats, with `--shadow`.
- **Field:** a `<textarea rows="2">` that grows to 12rem (`field-sizing: content`), or one `<input>` for the ask bar.
- **Submit:** a `.button.primary`, inside the frame, at its foot. "Ask" where a question starts something (the ask bar, a workstream), "Send" in a conversation.
- **Stop:** a `.button` in Send's place while the agent runs.
- **Notice:** one `role="alert"` line in `--danger`.

### Today, side by side

Each specimen below is Oriel's markup as the app renders it, with Oriel's CSS. Compare the frame, where the button sits, and the focus.

```html specimen id=today-ask-bar title="1. The ask bar (overview)" side=today
<section class="ask" aria-label="Ask about your window">
  <form class="ask-bar">
    <input
      type="text"
      class="ask-input"
      value=""
      placeholder="Ask about your window"
      aria-label="Ask about your window"
    />
    <button type="submit" class="button primary" disabled>Ask</button>
  </form>
  <ul class="ask-questions" aria-label="Questions to start from">
    <li>
      <button type="button" class="ask-question">
        Chart what moved since I looked, by workstream
      </button>
    </li>
    <li>
      <button type="button" class="ask-question">
        Should Vehicle and freight reservations become a workstream?
      </button>
    </li>
  </ul>
</section>
```

```html specimen id=proposed-ask-bar title="The ask bar as a ChatInput" side=proposed
<section class="ask" aria-label="Ask about your window">
  <form class="chat-input" data-lines="one" data-size="lg" data-marked>
    <input
      type="text"
      class="chat-input-field ask-input"
      placeholder="Ask about your window"
      aria-label="Ask about your window"
    />
    <button type="submit" class="button primary" disabled>Ask</button>
  </form>
  <ul class="ask-questions" aria-label="Questions to start from">
    <li>
      <button type="button" class="ask-question">
        Chart what moved since I looked, by workstream
      </button>
    </li>
    <li>
      <button type="button" class="ask-question">
        Should Vehicle and freight reservations become a workstream?
      </button>
    </li>
  </ul>
</section>
```

```html specimen id=today-composer title="2 and 3. The thread's and the window chat's composer" side=today
<form class="composer">
  <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
  <button type="submit" class="button primary" disabled>Send</button>
</form>
```

```html specimen id=proposed-composer title="The composer as a ChatInput (raised, in a thread)" side=proposed
<form class="chat-input" data-lines="grow" data-elevation="raised">
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about 17 items…"
    aria-label="Message"
  ></textarea>
  <button type="submit" class="button primary" disabled>Send</button>
</form>
```

```html specimen id=today-workstream title="4. The workstream's Ask box" side=today
<form class="composer ask">
  <textarea
    rows="2"
    placeholder="Ask about these 6 items…"
    aria-label="Ask about this workstream"
  ></textarea>
  <button type="submit" class="button primary" disabled>Ask</button>
</form>
<p class="notice" data-tone="error" role="alert">The agent couldn't start. Try again.</p>
```

```html specimen id=proposed-workstream title="The Ask box as a ChatInput (flat)" side=proposed
<form class="chat-input" data-lines="grow">
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about these 6 items…"
    aria-label="Ask about this workstream"
  ></textarea>
  <button type="submit" class="button primary" disabled>Ask</button>
  <p class="chat-input-notice" role="alert">The agent couldn't start. Try again.</p>
</form>
```

## States

Focus is forced in these specimens (`.ws-focus` and `.ws-focus-within` carry window.css's own `:focus` and `:focus-within` rules). Click into any of them to see the real thing.

```html specimen id=today-focus title="Focus today: a ring on the ask bar, a 1px tint on the composer" side=today state=focus
<div class="ws-stack">
  <form class="ask-bar">
    <input
      type="text"
      class="ask-input ws-focus"
      placeholder="Ask about your window"
      aria-label="Ask about your window"
    /><button type="submit" class="button primary" disabled>Ask</button>
  </form>
  <form class="composer ws-focus-within">
    <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea
    ><button type="submit" class="button primary" disabled>Send</button>
  </form>
</div>
```

```html specimen id=proposed-focus title="Focus proposed: one frame ring, in --focus" side=proposed state=focus
<div class="ws-stack">
  <form class="chat-input ws-focus-within" data-lines="one" data-size="lg" data-marked>
    <input
      type="text"
      class="chat-input-field"
      placeholder="Ask about your window"
      aria-label="Ask about your window"
    /><button type="submit" class="button primary" disabled>Ask</button>
  </form>
  <form class="chat-input ws-focus-within" data-lines="grow">
    <textarea
      class="chat-input-field"
      rows="2"
      placeholder="Ask about 17 items…"
      aria-label="Message"
    ></textarea
    ><button type="submit" class="button primary" disabled>Send</button>
  </form>
</div>
```

```html specimen id=state-typed title="Written: Send is live, and the field grows" side=today state=filled
<form class="composer">
  <textarea rows="2" aria-label="Message">
Which stories here still need estimates?
And which of them are blocked on design?</textarea>
  <button type="submit" class="button primary">Send</button>
</form>
```

```html specimen id=proposed-typed title="Written, proposed" side=proposed state=filled
<form class="chat-input" data-lines="grow">
  <textarea class="chat-input-field" rows="2" aria-label="Message">
Which stories here still need estimates?
And which of them are blocked on design?</textarea>
  <button type="submit" class="button primary">Send</button>
</form>
```

```html specimen id=state-running title="Busy: the agent is working, and Stop replaces Send" side=today state=busy
<ol class="chat">
  <li class="working" role="status"><span class="working-dot"></span> Working…</li>
</ol>
<form class="composer">
  <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
  <button type="button" class="button">Stop</button>
</form>
```

```html specimen id=proposed-running title="Busy, proposed" side=proposed state=busy
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
  <button type="button" class="button">Stop</button>
</form>
```

```html specimen id=state-error title="Error: one line, inside the frame" side=today state=error
<form class="composer">
  <textarea rows="2" placeholder="Ask about 17 items…" aria-label="Message"></textarea>
  <button type="submit" class="button primary" disabled>Send</button>
  <p class="composer-notice" role="alert">
    Claude Code stopped before it answered. Send again to retry.
  </p>
</form>
```

```html specimen id=proposed-error title="Error, proposed" side=proposed state=error
<form class="chat-input" data-lines="grow">
  <textarea
    class="chat-input-field"
    rows="2"
    placeholder="Ask about 17 items…"
    aria-label="Message"
  ></textarea>
  <button type="submit" class="button primary" disabled>Send</button>
  <p class="chat-input-notice" role="alert">
    Claude Code stopped before it answered. Send again to retry.
  </p>
</form>
```

```html specimen id=state-off title="Off: no AI set up (decision 0038)" side=today state=disabled
<section class="ask" aria-label="Ask about your window">
  <div class="ask-bar" data-off="true">
    <input
      type="text"
      class="ask-input"
      disabled
      placeholder="Set up Claude to ask about your window"
      aria-label="Set up Claude to ask about your window"
    />
    <a href="/settings" class="button primary">Set up</a>
  </div>
</section>
```

```html specimen id=proposed-off title="Off, proposed" side=proposed state=disabled
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

- **Rest:** placeholder in the field, submit disabled until something is written (and not only spaces).
- **Hover:** nothing; the frame doesn't change under the pointer.
- **Focus:** today the ask bar shows a 2px ring on `:focus` (even on a click), and the composers only tint their border by half the accent: the weakest focus in the app. Proposed: one ring on the frame, in `--focus`, on `:focus-within`.
- **Active:** not styled.
- **Disabled:** submit is disabled while the draft is blank or a send is under way. The field itself is never disabled, except with no AI set up ("off").
- **Busy:** "Working…" shows in the conversation above, and Stop replaces Send where the agent can be stopped (a thread, the window chat). The ask bar and the Ask box have no Stop.
- **Error:** one line. Today it's `.composer-notice` in a thread, `.ask-problem` on the overview and in the window chat (which can show both at once), and `.notice[data-tone="error"]` under the workstream's box.
- **Empty:** the window chat says what to ask about: "Ask about what changed, what needs you, or what should become a workstream."

## Keyboard and ARIA

- **Growing shape:** Settings' send key decides. With "Enter", Enter sends and Shift+Enter makes a new line; with "⌘Enter", ⌘Enter (Ctrl+Enter) sends and Enter makes a new line. An IME composition never sends. The handler is `sends()` (`sends` in `packages/web/src/settings.ts`).
- **One-line shape:** a form with one `<input>`, so Enter always submits (decision 0041).
- The keyboard path skips the button's `disabled`, so the reducer guards an empty or busy send (`updateThread` in `packages/web/src/thread.ts`). Keep that guard in the reducer.
- The field's accessible name is its `aria-label`: "Ask about your window", "Message", "Ask about this workstream". No chat input has a visible `<label>`; its placeholder and place say what it's for, and the `aria-label` says it to a screen reader. Don't make the name the placeholder's exact words where the placeholder carries a count.
- The notice is `role="alert"`, so it's read out when it appears.
- After a rejection, focus goes to the composer (`perform` in `packages/web/src/effects.ts`).

## Content

- Placeholders say what the question is about, never how to ask: "Ask about your window", "Ask about 17 items…", "Ask about this item…". Use the count of items, from `askPrompt` in `packages/web/src/workstream.ts`.
- Where there's nothing to ask about yet, the placeholder invites a plan: "What are you planning? Describe it, and ask for an epic and its stories…".
- Submit says **Ask** where a question starts something, **Send** inside a conversation.
- A problem says what happened and what to do: "Claude Code stopped before it answered. Send again to retry." Not "Error" or "Something went wrong".
- Questions to start from are whole questions in sentence case, about the person's own workstreams: "What moved in Payments?", "Why is Checkout v2 stalled?".

## Where the app uses it

- The ask bar: `AskBar` in `packages/web/src/window-chat-view.tsx`, mounted on the overview by `OverviewPage` in `packages/web/src/overview-page.tsx`. CSS `.ask`, `.ask-bar`, `.ask-input`, `.ask-questions`, `.ask-question` and `.ask-problem` in `window.css`, and the off state, `.ask-bar[data-off] .ask-input` in `window.css`.
- The thread composer: `Composer` in `packages/web/src/thread-page.tsx`, used by `ThreadPage` and `NewThreadPage`. CSS `.composer`, `.composer textarea`, `.composer-notice` and `.composer.ask` in `window.css`, made sticky by `.thread .composer` in `window.css`.
- The window chat's two composers: `WindowChat` in `packages/web/src/window-chat-view.tsx`.
- The workstream's Ask box, a copy of `Composer`: `WorkstreamPage` in `packages/web/src/workstream-page.tsx`.

## Drift

Status **drifting**: four versions of one control.

|            | Ask bar                          | Window chat                                       | Thread               | Workstream                  |
| ---------- | -------------------------------- | ------------------------------------------------- | -------------------- | --------------------------- |
| Field      | `<input>`, 2.375rem, `--text-lg` | `<textarea>`, grows                               | `<textarea>`, grows  | `<textarea>`, grows         |
| Frame on   | the input                        | the form, plus `--shadow` inside a shadowed panel | the form, `--shadow` | the form, no shadow         |
| Submit     | outside the field, centred       | inside, at the foot                               | inside, at the foot  | inside, at the foot         |
| Label      | Ask                              | Send                                              | Send                 | Ask                         |
| Stop       | no                               | with a thread                                     | yes                  | no                          |
| Focus      | 2px ring on `:focus`             | 1px border tint                                   | 1px border tint      | 1px border tint             |
| Error line | `.ask-problem`                   | `.ask-problem` and `.composer-notice`             | `.composer-notice`   | `.notice` outside the form  |
| Name       | "Ask about your window"          | "Message"                                         | "Message"            | "Ask about this workstream" |

Two hidden couplings: the workstream's form is `class="composer ask"`, so it picks up the overview's `.ask` section margin (`.ask` in `window.css`); and the window chat imports `Composer` from the thread's page file.

**Until ChatInput lands, copy the thread's `Composer`** (`Composer` in `packages/web/src/thread-page.tsx`) for any new place that asks: import it, don't hand-copy it. The full proposal, with its API, migration and the shots it touches, is [D3 in the drift report](/drift#d3-one-chatinput-for-the-four-places-a-person-asks).
