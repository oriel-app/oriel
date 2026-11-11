---
title: Switch
status: stable
group: Inputs
order: 45
classes: switch, switch-knob, settings-switch, settings-field, settings-field-name, settings-field-about
summary: One thing on or off, taking effect at once. A button with role="switch"; on is the accent.
---

# Switch

## What it is

A track with a knob that turns one thing on or off, at once, with no Save. "A switch: on is the accent, your choice made" (`.switch` in `window.css`). It's one component, `Switch` in `packages/web/src/provider-row.tsx`: a `<button type="button" role="switch">` whose `aria-checked` says whether it's on, holding a `.switch-knob`.

It sits in two places:

- **At the end of a provider row**, to use a provider or not: "Use Claude Code".
- **In a settings field** (`.settings-field.settings-switch`): the field's name and about line on the left, the switch on the right, centred across both lines. "Notify me when a thread needs me", "Ask before quitting while Oriel works", and a connection's "Oriel may propose changes".

The [switch lab](/lab/switch) compares other ways to build one, and a locked state the keyboard can reach.

## When to use it

- For one setting that is plainly on or off, where the change applies the moment it's flipped and can be flipped back.
- When the setting's name reads as a statement that's true when on: "Notify me when a thread needs me", "Oriel may propose changes".

## When not to

- Not for a choice between two named options. "Relative" or "Date and time" is a [radio list](/components/checkbox-radio), even with only two.
- Not for something that needs a confirm or takes a while to finish, such as Disconnect. That's a [button](/components/button) with a question.
- Not to pick rows out of a list. That's a [checkbox](/components/checkbox-radio).
- Not inside a form that has a Save button. A switch saves itself.

## Anatomy and variants

- **Track** (`.switch`): 2.25rem by 1.25rem, `--radius-lg`, a `--border-thin` edge. Off, it's an outline: the edge in `--text-faint` on `--surface`. On, edge and fill are `--accent`.
- **Knob** (`.switch-knob`): 0.875rem, 0.1875rem in from the track's outer edge. Off, it's `--text-faint`; on, `--on-accent` with `--shadow-sm`, moved 1rem right. The colours and the move take `--duration-quick` with `--ease-out`; reduced motion turns them off (`.switch-knob` in `window.css`).
- **Contrast:** off, the edge and knob are 5.4:1 (Graphite light), 5.9:1 (Graphite dark), 6.3:1 (Broadsheet light) and 6.0:1 (Broadsheet dark) against `--surface`. The old `--line-strong` track was 1.6:1 to 2.4:1.
- **Field** (`.settings-field.settings-switch`): a two-column grid, `1fr auto`. `.settings-field-name` (medium weight) over `.settings-field-about` (faint, small), and the switch spanning both rows.

```html specimen id=settings-field title="In a settings field: Settings › Notifications"
<div class="settings-field settings-switch">
  <span class="settings-field-name">Notify me when a thread needs me</span>
  <span class="settings-field-about"
    >A change set to review, an answer waiting on you, or a held message, while Oriel's window isn't
    in front. Clicking one opens its thread.</span
  >
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="true"
    aria-label="Notify me when a thread needs me"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

```html specimen id=provider-row title="At the end of a provider row: Settings › Providers"
<ul class="provider-rows">
  <li class="provider-row" data-status="ready">
    <span class="provider-icon" aria-hidden="true">C</span>
    <div class="provider-main">
      <span class="provider-name">Claude Code</span>
      <span class="provider-about"
        >For Claude Pro and Max · Anthropic's assistant for your Mac</span
      >
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span></span
      >
      <span class="provider-uses">Not in use</span>
    </div>
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked="true"
      aria-label="Use Claude Code"
    >
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
  <li class="provider-row" data-status="ready" data-off>
    <span class="provider-icon" aria-hidden="true">O</span>
    <div class="provider-main">
      <span class="provider-name">Codex<span class="provider-badge">Preview</span></span>
      <span class="provider-about">For ChatGPT plans · OpenAI's assistant for your Mac</span>
      <span class="provider-status"
        ><span class="provider-mark" aria-hidden="true"></span
        ><span class="provider-state">Ready</span></span
      >
    </div>
    <button type="button" role="switch" class="switch" aria-checked="false" aria-label="Use Codex">
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </li>
</ul>
```

```html specimen id=locked title="Locked by its source: a connection the person can only view"
<div class="settings-field settings-switch" data-locked>
  <span class="settings-field-name">Oriel may propose changes</span>
  <span class="settings-field-about"
    >You can only view these spreadsheets in Google Sheets, so Oriel only reads them.</span
  >
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="false"
    aria-label="Oriel may propose changes to Google Sheets"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

The locked switch is off and disabled, and its about line says why in place of what the switch does. "A switch its source locks, as for a spreadsheet the person can only view" (`.switch:disabled` in `window.css`).

## States

Click a switch in any specimen to flip it.

```html specimen id=state-off-on title="Off and on" state=rest
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="false"
    aria-label="Use Claude Code"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="true"
    aria-label="Use Claude Code"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

```html specimen id=state-hover title="Hover: an off switch darkens" state=hover
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch ws-hover"
    aria-checked="false"
    aria-label="Use Claude Code"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch ws-hover"
    aria-checked="true"
    aria-label="Use Claude Code"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

```html specimen id=state-focus title="Focus visible" state=focus-visible
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch ws-focus-visible"
    aria-checked="false"
    aria-label="Use Claude Code"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch ws-focus-visible"
    aria-checked="true"
    aria-label="Use Claude Code"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

```html specimen id=state-disabled title="Disabled (locked)" state=disabled
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="false"
    aria-label="Oriel may propose changes to Google Sheets"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="true"
    aria-label="Ask before quitting while Oriel works"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

- **Rest:** off is the `--text-faint` outline, knob left; on is the `--accent` track, knob right.
- **Hover:** off, the edge and knob darken to `--text-muted`. On doesn't change.
- **Forced colours:** backgrounds are dropped, so the knob is drawn as a ring (`--border-thick`) in the system's text colour, inside the track's edge; where it sits says on or off.
- **Focus visible:** the global ring, 2px out (`:focus-visible` in `window.css`).
- **Active:** not styled.
- **Disabled:** `opacity: 0.5` and `cursor: not-allowed` (`.switch:disabled` in `window.css`). Only a connection its source locks uses it, and its about line says why.
- **Busy:** none. The switch flips at once, and the setting saves behind it. If the save fails, Settings shows `.settings-problem` at the top of the page and loads again, so the switch shows what was kept.
- **Error, empty:** don't apply.
- `.settings-switch[data-locked]` is set on a locked field (`ReadOnly` in `packages/web/src/connections-page.tsx`) but nothing styles it.

## Keyboard and ARIA

- A native `<button>`, so Tab reaches it and Space or Enter flips it. Its click calls `onChange(!on)`.
- `role="switch"` with `aria-checked="true"` or `"false"`; a screen reader says "on" or "off".
- The accessible name is its `aria-label`, which repeats the visible field name ("Notify me when a thread needs me") or says what it does to what ("Use Claude Code", "Oriel may propose changes to Google Sheets"). The visible name is a `<span>`, not a `<label>`, so clicking the words doesn't flip it.
- The about line isn't tied to it with `aria-describedby`, so a screen reader doesn't hear why a locked switch is locked.

## Content

- Name it as a statement that's true when it's on: "Ask before quitting while Oriel works", not "Quit confirmation".
- The about line says what on means, or both: "Off, Oriel only reads Jira, and the agent can't propose a change to it. On, nothing changes there until you approve it."
- Where only the desktop app can do it, the field is replaced by a sentence saying so: "Only the desktop app shows notifications."
- No "on"/"off" text beside the switch. The track says it.

## Where the app uses it

- `Switch` in `packages/web/src/provider-row.tsx`, put in a provider row by `ProviderRow`.
- Ask before quitting: `General` in `packages/web/src/settings-page.tsx`. Notifications: `Notifications` in `packages/web/src/settings-page.tsx`.
- A connection's Oriel may propose changes, locked or not: `ReadOnly` in `packages/web/src/connections-page.tsx`.
- CSS: `.switch`, `.switch[aria-checked="true"]`, `.switch-knob`, `.switch[aria-checked="true"] .switch-knob`, their hover rules, `.switch-knob` under `@media (forced-colors: active)`, `.settings-switch` and `.switch:disabled` in `window.css`, and reduced motion under `@media (prefers-reduced-motion: reduce)` in `window.css`.
