---
title: Switch
status: proposed
order: 30
summary: Today's switch is a button with role switch. Three ways to build one, compared, and a redraw whose off state can be seen in every theme and whose locked state can be reached by keyboard. Keep the button.
classes: switch-track, switch, switch-knob, settings-switch, settings-field, settings-field-name, settings-field-about
---

# Switch

## What it is

A switch turns one setting on or off, and it takes effect at once: no Save. On is the accent, "your choice made" (`.switch` in `window.css`). Oriel has four: "Use Claude Code" (and Codex) on a provider row, "Ask before quitting while Oriel works" and "Notify me when a thread needs me" in Settings, and "Oriel may propose changes to …" on a connection, which its source can lock.

There are three ways to build one:

1. **A button with `role="switch"`**, which is today's: `<button type="button" role="switch" aria-checked>` with a `.switch-knob` span inside (`Switch` in `packages/web/src/provider-row.tsx`).
2. **A checkbox with `role="switch"`**, drawn with `appearance: none`.
3. **The `switch` attribute**, `<input type="checkbox" switch>`. Safari draws it as a switch and tells a screen reader it is one. **Chromium hasn't shipped it**, so in the desktop app it's a plain checkbox.

The proposal keeps the button and redraws it with one class, `.switch-track`, which also draws the other two, so they can be compared here.

## Today

Settings › General, as the app renders it, off and on.

```html specimen id=today-settings title="Today: .switch in a settings field" side=today
<div class="ws-stack">
  <div class="settings-field settings-switch">
    <span class="settings-field-name">Notify me when a thread needs me</span>
    <span class="settings-field-about"
      >A change set to review, an answer waiting on you, or a held message, while Oriel's window
      isn't in front. Clicking one opens its thread.</span
    >
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked="false"
      aria-label="Notify me when a thread needs me"
    >
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </div>
  <div class="settings-field settings-switch">
    <span class="settings-field-name">Ask before quitting while Oriel works</span>
    <span class="settings-field-about"
      >While a thread's turn is running or a change set is applying, Quit (Cmd+Q) and closing
      Oriel's window ask first.</span
    >
    <button
      type="button"
      role="switch"
      class="switch"
      aria-checked="true"
      aria-label="Ask before quitting while Oriel works"
    >
      <span class="switch-knob" aria-hidden="true"></span>
    </button>
  </div>
</div>
```

```html specimen id=proposed-settings title="Proposed: the same button, drawn by .switch-track" side=proposed
<div class="ws-stack">
  <div class="settings-field settings-switch">
    <span class="settings-field-name">Notify me when a thread needs me</span>
    <span class="settings-field-about" id="notify-about"
      >A change set to review, an answer waiting on you, or a held message, while Oriel's window
      isn't in front. Clicking one opens its thread.</span
    >
    <button
      type="button"
      role="switch"
      class="switch-track"
      aria-checked="false"
      aria-label="Notify me when a thread needs me"
      aria-describedby="notify-about"
    ></button>
  </div>
  <div class="settings-field settings-switch">
    <span class="settings-field-name">Ask before quitting while Oriel works</span>
    <span class="settings-field-about" id="quit-about"
      >While a thread's turn is running or a change set is applying, Quit (Cmd+Q) and closing
      Oriel's window ask first.</span
    >
    <button
      type="button"
      role="switch"
      class="switch-track"
      aria-checked="true"
      aria-label="Ask before quitting while Oriel works"
      aria-describedby="quit-about"
    ></button>
  </div>
</div>
```

## Proposed

`assets/proposals/switch.css`, one class on the control itself; the knob is its `::before`, so there's no `.switch-knob` span. The same size and the same move as today (2.25rem by 1.25rem, the knob 1rem along). What changes:

- **Off can be seen.** Today's off track is `--line-strong` on the surface, 1.8:1 to 2.4:1 across the themes, and its knob is `--on-accent`. In the dark schemes `--on-accent` is the dark ink, so the off knob is dark on a dark track (1.9:1). Proposed, off is an outline: a `--border-thin` edge and a knob in `--text-faint`, 5.4:1 to 6.3:1 against `--surface`. On is unchanged: the accent, with the knob in `--on-accent`.
- **Hover is styled**: the edge and knob darken to `--text-muted`. Today a switch doesn't change under the pointer.
- **It survives high-contrast mode.** Today's switch is drawn only with backgrounds, which Windows' forced colours drop; it vanishes. The proposed one keeps its edge and draws its knob as a ring there.
- **Locked can be reached.** See States.
- **The reason is read out.** `aria-describedby` points at the field's `.settings-field-about`, so a screen reader hears what the switch does, and, when locked, why.

The three builds, side by side. Each one flips here; try them by keyboard.

```html specimen id=build-button title="1. A button with role=switch (today's element; recommended)" side=proposed
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch-track"
    aria-checked="true"
    aria-label="Use Claude Code"
  ></button>
  <span>Use Claude Code</span>
</div>
```

```html specimen id=build-checkbox title="2. A checkbox with role=switch" side=proposed
<label class="ws-row">
  <input type="checkbox" role="switch" class="switch-track" checked />
  <span>Use Claude Code</span>
</label>
```

```html specimen id=build-attribute title="3. The switch attribute (Safari only; a checkbox in Chromium)" side=proposed
<label class="ws-row">
  <input type="checkbox" switch role="switch" class="switch-track" checked />
  <span>Use Claude Code</span>
</label>
```

## States

Today's (left) and proposed (right), in each state. Hover and focus are forced with `ws-hover` and `ws-focus-visible`.

```html specimen id=today-states title="Today: off, on, hover, focus, disabled" side=today
<div class="ws-row">
  <button type="button" role="switch" class="switch" aria-checked="false" aria-label="Off">
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button type="button" role="switch" class="switch" aria-checked="true" aria-label="On">
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch ws-hover"
    aria-checked="false"
    aria-label="Off, hover"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch ws-focus-visible"
    aria-checked="false"
    aria-label="Off, focus"
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="false"
    aria-label="Off, disabled"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked="true"
    aria-label="On, disabled"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

```html specimen id=proposed-states title="Proposed: off, on, hover, focus, disabled" side=proposed
<div class="ws-row">
  <button
    type="button"
    role="switch"
    class="switch-track"
    aria-checked="false"
    aria-label="Off"
  ></button>
  <button
    type="button"
    role="switch"
    class="switch-track"
    aria-checked="true"
    aria-label="On"
  ></button>
  <button
    type="button"
    role="switch"
    class="switch-track ws-hover"
    aria-checked="false"
    aria-label="Off, hover"
  ></button>
  <button
    type="button"
    role="switch"
    class="switch-track ws-focus-visible"
    aria-checked="false"
    aria-label="Off, focus"
  ></button>
  <button
    type="button"
    role="switch"
    class="switch-track"
    aria-checked="false"
    aria-label="Off, disabled"
    disabled
  ></button>
  <button
    type="button"
    role="switch"
    class="switch-track"
    aria-checked="true"
    aria-label="On, disabled"
    disabled
  ></button>
</div>
```

```html specimen id=today-locked title="Locked today: disabled, so Tab skips it and its reason isn't tied to it" side=today state=disabled
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
    aria-label="Oriel may propose changes to Ferrowick launch RAID log"
    disabled
  >
    <span class="switch-knob" aria-hidden="true"></span>
  </button>
</div>
```

```html specimen id=proposed-locked title="Locked, proposed: aria-disabled, so Tab reaches it and hears why" side=proposed state=disabled
<div class="settings-field settings-switch" data-locked>
  <span class="settings-field-name">Oriel may propose changes</span>
  <span class="settings-field-about" id="raid-why"
    >You can only view these spreadsheets in Google Sheets, so Oriel only reads them.</span
  >
  <button
    type="button"
    role="switch"
    class="switch-track"
    aria-checked="false"
    aria-label="Oriel may propose changes to Ferrowick launch RAID log"
    aria-describedby="raid-why"
    aria-disabled="true"
  ></button>
</div>
```

- **Off, on:** both. Off is `aria-checked="false"`, on is `"true"`; for a checkbox build, `:checked`.
- **Hover:** not styled today. Proposed, the edge and the off knob darken; on stays the accent.
- **Focus-visible:** window.css's ring (`:focus-visible` in `window.css`) in both, round the track.
- **Active:** not styled in either.
- **Disabled:** `opacity: 0.5` and `not-allowed`, as `.switch:disabled` in `window.css` does today. Nothing in Oriel disables a switch except the lock.
- **Locked:** a connection whose source lets the person only view it (decision 0050, `ReadOnly` in `packages/web/src/connections-page.tsx`). Today it's `disabled`, so the keyboard can't reach it, and `.settings-switch[data-locked]` is set but not styled. Proposed: `aria-disabled="true"` looks the same, stays in the tab order, is announced as dimmed, and its `aria-describedby` reads the reason. The click handler must ignore it (here, `assets/frame.js` cancels the click).
- **Busy, error, empty:** don't apply. A switch saves at once; a failed save is reported by the page, as Settings does.

## Keyboard and ARIA

|                | Button, `role="switch"` (today)                   | Checkbox, `role="switch"`                                   | `switch` attribute                                    |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Tab            | Reaches it                                        | Reaches it                                                  | Reaches it                                            |
| Space          | Flips                                             | Flips                                                       | Flips                                                 |
| Enter          | **Flips**                                         | Does nothing (or submits a form)                            | Does nothing (or submits a form)                      |
| Role heard     | switch, on/off                                    | switch, on/off (Chromium); checkbox where `role` is ignored | switch in Safari; checkbox in Chromium without `role` |
| State lives in | `aria-checked`, set by the app                    | `checked`, the browser's                                    | `checked`, the browser's                              |
| Label click    | Needs `aria-label` (the field name is a `<span>`) | A `<label>` flips it                                        | A `<label>` flips it                                  |
| Form value     | None (Oriel saves on change)                      | Yes                                                         | Yes                                                   |

- Today's keys are Space and Enter. A checkbox loses Enter, which the switch pattern allows but which would change what Oriel does now. Oriel posts each switch's change at once and has no form around it, so the checkbox's gains (a form value, a label's click) buy nothing here.
- Keep `aria-label` the field's name, as today ("Notify me when a thread needs me"), and add `aria-describedby` to the field's about line.
- A locked switch: `aria-disabled="true"`, not `disabled`, and the handler returns early.

## Support and fallback

| Feature                                | Chromium                                         | Desktop (Chromium 156) | Safari / Firefox        | Fallback                                         |
| -------------------------------------- | ------------------------------------------------ | ---------------------- | ----------------------- | ------------------------------------------------ |
| `role="switch"` on a button (today)    | Yes                                              | Yes                    | Yes                     | n/a                                              |
| `::before` on a `<button>`             | Yes                                              | Yes                    | Yes                     | n/a                                              |
| `appearance: none` on a checkbox       | 84                                               | Yes                    | Safari 15.4, Firefox 80 | n/a                                              |
| `role="switch"` on a checkbox          | Yes                                              | Yes                    | Yes                     | n/a                                              |
| `<input type="checkbox" switch>`       | **Not shipped** (intent to prototype, July 2026) | **No**: a checkbox     | Safari 17.4; Firefox no | `role="switch"` on the same input, as in build 3 |
| `aria-disabled` and `aria-describedby` | Yes                                              | Yes                    | Yes                     | n/a                                              |

No `@supports` is needed: nothing here is newer than every engine Oriel meets. Safari and Firefox weren't run here: no matching engine was installed. No switch is on the review link's page.

**Windows' high-contrast mode** (`forced-colors: active`, emulated in Chrome 156): backgrounds are dropped, so **today's switch disappears entirely**, track and knob, leaving only its focus ring. The proposed track keeps its border, and there its knob is drawn as a ring, so where it sits still says on or off.

## Adopt now or wait

- **Keep the button** (build 1). It's what Oriel has, Enter and Space both flip it, and Oriel saves on change, with no form to submit. The browser notes say the same.
- **Wait on the `switch` attribute.** Chromium doesn't have it, so the desktop app would get a checkbox. Revisit when it ships in Chromium; it would then give the role for free, but the button would still be the better fit for a save-on-change setting.
- **Don't use a checkbox with `role="switch"`.** It loses Enter, and it gains nothing Oriel uses.
- **Adopt the redraw now**: the visible off state is a real fix in the dark schemes, where today's off knob nearly vanishes. It's a CSS change and one prop.
- **Adopt the locked state now**: `aria-disabled` plus `aria-describedby`, so a keyboard user can find out why it's locked.

## How to migrate

1. Replace `.switch`, `.switch[aria-checked="true"]`, `.switch-knob` and `.switch[aria-checked="true"] .switch-knob` in `window.css` with the rules in `assets/proposals/switch.css`, renamed from `.switch-track` to `.switch`. Keep `.switch:disabled` in `window.css` and add `[aria-disabled="true"]` to it. Keep `.switch` and `.switch-knob` under `@media (prefers-reduced-motion: reduce)` in `window.css`, adding `.switch::before`.
2. Drop the `.switch-knob` span from `Switch` in `packages/web/src/provider-row.tsx`. Add a `describedBy` prop for `aria-describedby`, and a `locked` prop that sets `aria-disabled="true"` in place of `disabled` and returns early in `onClick`.
3. Give each `.settings-field-about` an `id` and pass it, from `General` and `Notifications` in `packages/web/src/settings-page.tsx` and from `ReadOnly` in `packages/web/src/connections-page.tsx`, which passes `locked` too.
4. Rerun `pnpm shots` for Settings › General, a connection locked by its source and the first run's provider rows, in both themes and both schemes.
