---
title: Button
status: drifting
group: Actions
order: 10
classes: button, primary, danger, setup-next, quiet-action, link-action, undo-action
summary: An action someone takes. One primary per moment, a bordered button for the rest, and a quiet action for what can wait.
---

# Button

## What it is

A control that does something now: sends, approves, connects, deletes. Oriel has three weights of button, plus two text-shaped actions:

- **Primary** (`.button.primary`): the accent fill. The accent means "your move" (decision 0034), so a primary button is the one thing the person is expected to do next: Approve and apply, Send, Ask, Connect.
- **Button** (`.button`): bordered, on the surface. Every other action with weight: Reject, Cancel, Try again, Show details.
- **Danger** (`.button.danger`): the danger fill, only for the confirm step of something that can't be taken back by Undo: Delete in the one question a delete asks, Disconnect.
- **Quiet action** (`.quiet-action`): "text until hovered" (`.quiet-action` in `window.css`). For actions that sit beside content and shouldn't compete with it: Mark done, Share review link, Dismiss, Open as a thread.
- **Link action** (`.link-action`): an underlined accent word, for "a way on that isn't the step's own" (`.link-action` in `window.css`), as in the first run: Set up later, Pay Anthropic per question instead.
- **Undo action** (`.undo-action`): the accent word beside a change it undoes: Undo, Redo. In the bead, the same Undo is a `.bead-action` (see [Undo](/components/undo)).

## When to use it

- Use **one primary per moment**: per change set, per form, per step. In a thread, Approve and apply is "the one primary action" (`ChangeSet` in `packages/web/src/thread-page.tsx`).
- Use `.button` for the other choices in the same group as a primary, so the two read as a pair: **Approve and apply** and **Reject**.
- Use `.quiet-action` when the action is optional and frequent, and would make a dense page noisy as a bordered button: a header's Mark done, a list's Clear filters.
- Use `.button.danger` only as the second step of a destructive action, inside the question that confirms it. See [Destructive actions and undo](/patterns/destructive-actions).

## When not to

- Not for going somewhere. A place is a link (`<a href>`), drawn as a [nav link](/components/sidebar) or in the text. An `<a class="button">` is right only when it leaves Oriel (Open in Jira, See Claude plans) or starts a step elsewhere (Set up).
- Not a second primary. If two actions both feel primary, one of them is a `.button`.
- Not `.button.danger` for a first click. The first click on Delete opens the question; only its confirm is red.
- Not an icon alone where a word fits. Icon buttons exist (see [Icon button](/components/icon-button)), but each needs an `aria-label`, and most actions read better as words.

## Anatomy and variants

A button is its label, optionally after a 1rem `.icon`. Padding is `0.25rem var(--space-3)`, the label `--text-sm` at `--weight-medium`, the corner `--radius`, the edge `--border-thin` in `--line-strong`.

```html specimen id=kinds title="Kinds, by weight"
<div class="ws-row">
  <button type="button" class="button primary">Approve and apply</button>
  <button type="button" class="button">Reject</button>
  <button type="button" class="quiet-action">Share review link</button>
</div>
```

```html specimen id=danger title="Danger, in the confirm step only"
<div class="ws-row">
  <button type="button" class="button">Cancel</button>
  <button type="button" class="button danger">Delete</button>
</div>
```

```html specimen id=text-actions title="Text-shaped actions"
<div class="ws-stack">
  <p class="ws-note">A link action, for a way on that isn't the step's own:</p>
  <button type="button" class="link-action">Set up later</button>
  <p class="ws-note">An undo action, beside what it undoes:</p>
  <p class="panel-added">
    <span>Added to “Checkout v2: phone wallets and saved cards”.</span>
    <button type="button" class="undo-action" aria-label="Undo: Added to “Checkout v2”.">
      Undo
    </button>
  </p>
</div>
```

```html specimen id=as-link title="As a link that leaves Oriel"
<div class="ws-row">
  <a
    class="button"
    href="https://example.atlassian.net/browse/SYN-12"
    target="_blank"
    rel="noopener noreferrer"
    >Open in Jira</a
  >
  <a class="button primary" href="/settings/providers">Set up</a>
</div>
```

```html specimen id=setup-next title="The first run's bigger way on (.setup-next)"
<div class="ws-row">
  <button type="button" class="button primary setup-next">Continue with Claude Code</button>
  <button type="button" class="button setup-next">Back</button>
</div>
```

## States

Hover and focus here are forced: the workshop copies window.css's own `:hover` and `:focus-visible` rules onto `.ws-hover` and `.ws-focus-visible`, so they are exactly what the app draws. Tab into any specimen to see the real thing.

```html specimen id=state-rest title="Rest" state=rest
<div class="ws-row">
  <button type="button" class="button primary">Send</button>
  <button type="button" class="button">Stop</button>
  <button type="button" class="quiet-action">Mark done</button>
  <button type="button" class="button danger">Delete</button>
</div>
```

```html specimen id=state-hover title="Hover" state=hover
<div class="ws-row">
  <button type="button" class="button primary ws-hover">Send</button>
  <button type="button" class="button ws-hover">Stop</button>
  <button type="button" class="quiet-action ws-hover">Mark done</button>
  <button type="button" class="button danger ws-hover">Delete</button>
</div>
```

```html specimen id=state-focus title="Focus visible" state=focus-visible
<div class="ws-row">
  <button type="button" class="button primary ws-focus-visible">Send</button>
  <button type="button" class="button ws-focus-visible">Stop</button>
  <button type="button" class="quiet-action ws-focus-visible">Mark done</button>
  <button type="button" class="button danger ws-focus-visible">Delete</button>
</div>
```

```html specimen id=state-active title="Active (pressed): not styled today" state=active
<div class="ws-row">
  <button type="button" class="button primary ws-active">Send</button>
  <button type="button" class="button ws-active">Stop</button>
</div>
```

```html specimen id=state-disabled title="Disabled" state=disabled
<div class="ws-row">
  <button type="button" class="button primary" disabled>Send</button>
  <button type="button" class="button" disabled>Sync</button>
  <button type="button" class="quiet-action" disabled>New chat</button>
  <button type="button" class="undo-action" disabled>Undo</button>
</div>
```

```html specimen id=state-busy title="Busy: the label says what's happening" state=busy
<div class="ws-row">
  <button type="button" class="button danger" disabled>Deleting…</button>
  <button type="button" class="button primary" disabled>Connecting…</button>
  <button type="button" class="button" disabled>Checking…</button>
</div>
```

- **Rest, hover, focus-visible, disabled** are styled. Hover is guarded by `:not(:disabled)` on `.button` and `.quiet-action`.
- **Active** isn't styled anywhere in window.css. A press shows nothing beyond hover. That's acceptable for a dense tool, but see the drift report.
- **Disabled** is `opacity: 0.5` on `.button`, `.quiet-action` and `.link-action`. The `.undo-action` has no disabled look, so a disabled Undo looks live (last specimen in its row above).
- **Busy** is a disabled button whose label becomes the verb with "…": Delete → Deleting…, Connect → Connecting…, Check again → Checking…. No button sets `aria-busy`; the region that's busy does (a change set, a thread).
- **Error** and **empty** don't apply to a button. A failed action says so in the line under it (see [Empty, loading and error](/components/states)).

## Keyboard and ARIA

- A native `<button type="button">`, or `type="submit"` in a form. Enter and Space press it; it's in the tab order.
- Focus shows the global ring: `--border-thick` in `--focus` (the accent), 2px out (`:focus-visible` in `window.css`).
- A button that shows and hides something sets `aria-expanded` (Show details, the overview's counts). Its label may change (Show/Hide), but the look doesn't: `[aria-expanded="true"]` isn't styled.
- A button whose label is only an icon or a `×` needs `aria-label`, written as the action and its object: "Remove SYN-12", "Close the panel".
- The newest Undo in the bead carries `aria-keyshortcuts="Meta+Z"` and answers ⌘Z (Ctrl+Z) when focus isn't in a field (`UndoStack` in `packages/web/src/undo-stack.tsx`). F8 takes the keyboard to it (see [The bead](/components/bead)).

## Content

- A verb, in sentence case, saying what happens: **Approve and apply**, **Make a workstream**, **Disconnect**. Not "OK", "Submit" or "Yes".
- Name the object when the button is alone: **Add to workstream**, **Open in Jira**. Inside a card that already names it, the verb is enough: **Reject**.
- Busy labels are the verb's -ing form plus "…" (U+2026): **Deleting…**, **Checking…**. Never "Loading".
- A button that opens a question ends in "…": **Delete…** in a menu (the dialog asks before anything happens).
- Approving says what it does: **Approve and apply** in a thread. The review link page says **Approve**; see the drift report.

## Where the app uses it

- `.button` and `.button.primary` in `window.css`. The change set's steps: `ChangeSet` in `packages/web/src/thread-page.tsx`. The chat input's Send, Ask and Stop, plain until something is written: `ChatInput` in `packages/web/src/chat-input.tsx`. The ask bar's Ask: `AskBar` in `packages/web/src/window-chat-view.tsx`. Connect steps: `FieldsStep` in `packages/web/src/connect-steps.tsx`.
- `.button.danger` in `window.css`. The confirm: `Confirm` in `packages/web/src/close-thread.tsx`. Disconnect: `Disconnect` in `packages/web/src/connections-page.tsx`.
- `.quiet-action` in `window.css`. Mark done: `ThreadPage` in `packages/web/src/thread-page.tsx`. Share review link: `ChangeSet` in `packages/web/src/thread-page.tsx`. Open as a thread and New chat: `WindowChat` in `packages/web/src/window-chat-view.tsx`.
- `.link-action` in `window.css`. The first run's `link()`: `link` in `packages/web/src/setup-page.tsx`; the CLI row's `quiet()`: `ClaudeCodeRow` in `packages/web/src/cli-row.tsx`.
- `.undo-action` in `window.css`, drawn by `UndoButton` in `packages/web/src/undo-stack.tsx`, which the bead draws as a `.bead-action`.
- `.setup-next` in `window.css`, drawn by `YourAi` in `packages/web/src/setup-page.tsx`.

## Drift

Status **drifting**. The kinds are sound; what drifts is which kind an action gets:

- "Try again" is a `.button`, a `.button.primary` and a `.quiet-action` in different places (`Body` in `packages/web/src/window-page.tsx`, `Failed` in `packages/web/src/setup-page.tsx`, `OverviewPage` in `packages/web/src/overview-page.tsx`). "Cancel" is `.button`, `.quiet-action` and `.link-action`.
- `.button.danger` in `window.css` sits beside the context menu, not with the other buttons.
- `.undo-action` has no disabled look, and its hover isn't guarded.
- `cli-row.tsx` has a helper called `quiet()` that draws a `.link-action`, twice over (once each in `ClaudeCodeRow` and `CodexRow` in `packages/web/src/cli-row.tsx`).

Rule of thumb, until a `Button` component settles it: **retry is a `.button`** beside the error that caused it (primary only when it's the step's own way on); **Cancel is a `.button`** in a form or dialog and a `.quiet-action` elsewhere; **Dismiss is a `.quiet-action`**. See [the drift report](/drift#d2-one-disabled-look-and-one-button-kind-rule).
