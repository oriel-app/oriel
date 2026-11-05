---
title: Colour
order: 10
summary: Oriel's colour tokens by role, in Graphite and Broadsheet, light and dark. The accent means "your move", five states stay apart, and every pair is checked.
---

# Colour

Oriel's colours are tokens, and a rule reads only tokens. A theme is a block of values for them, light and dark (decision 0034). Graphite is the default: warm greys and one indigo accent. Broadsheet is the second: cream paper, ink and an umber accent. Light or dark is the system's choice. A rule never names a colour, and Oriel's own theme check fails the build if one does.

Pick a token by its **role**, never by how it looks in the theme in front of you. `--text-muted` is grey in Graphite and brown in Broadsheet. What it means stays the same.

## Backgrounds

- `--bg`: the window's paper, behind every page.
- `--surface`: what sits on the paper and holds content, such as a panel, a list frame, a field or a card. Graphite's is white on warm grey. Broadsheet's is lighter cream on cream.
- `--surface-hover`: a row or button under the pointer, or a menu item in focus. It's also the avatar's fill.
- `--surface-sunk`: half way from `--bg` to `--surface`. Use it for a well inside a surface, such as a read-only field or code.
- `--list-bg`: behind the overview's lists. Graphite frames its lists on `--surface`. Broadsheet leaves them open, on `--bg`.
- `--sidebar-bg` (derived): the sidebar's column, `--bg` mixed 4% toward the ink.

## Lines

- `--line`: a hairline between rows, round a list or a quiet field.
- `--line-strong`: the edge of a control a person acts on: a button, a text field, the composer. It's also Graphite's section rule.
- `--derived-line` (derived): the edge of something Oriel worked out, such as an Oriel rule's note.

Lines are hairlines, and they aren't meant to tell anything alone. See [Contrast](#contrast) for what that means for a control's edge.

## Text

- `--text`: what people read. Titles, names, a message.
- `--text-muted`: what supports it. A row's detail, a section head, an item's key after its name.
- `--text-faint`: what can be skipped. A time, a count, a placeholder, a chevron.
- `--del`: deleted words in a diff. It's `--text-faint`'s value, drawn with a line through it.
- `--on-accent`: text on a fill: the accent (a primary button), `--done` and `--danger` (the swipe's actions).

All three text greys pass 4.5:1 on every background, in both themes and both schemes. `--text-faint` is the closest, at 4.58:1 on `--surface-hover` in Graphite light.

## The accent: your move

`--accent` means "your move" (decision 0034). It marks what is waiting on the person: Needs you, a change set to review, Approve and apply, a held message, a stalled apply. There's no separate needs-you colour.

- Use it for the one thing a person is expected to do next: a primary button, a count of what's waiting, a link that's a way on.
- Don't use it for decoration, a heading, a selected tab, or to say something is good. A picked checkbox and an on switch use it because picking is the person's own act.
- `--focus` in `window.css` is derived: it's the accent. The focus ring is the same colour as "your move", so a keyboard user's place reads as theirs.

## The five states a PM scans for

A person scanning 40 workstreams tells where each thing stands by a 7px dot or a word in its colour. Five colours carry that, and they must never be confused:

| Token           | Means                                     | Where you see it                                           |
| --------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `--accent`      | Your move                                 | Needs review, Message held, Apply stalled                  |
| `--in-progress` | Moving                                    | Agent working, Applying…, an item in progress              |
| `--danger`      | Something's wrong, or an item has stalled | A failed load, a line that wasn't applied, Delete          |
| `--done`        | Finished                                  | Done, applied, inserted words. Handed off is drawn as done |
| `--derived`     | Oriel worked this out                     | An Oriel rule, a search's label, "has changed since"       |

`--todo` is a sixth, quieter colour: to do, and dropped. It isn't one of the five because it means "nothing happening", and it's a grey.

**Why they must stay apart.** Oriel's theme check (`scripts/check-themes.ts`) measures every pair of the five in CIEDE2000. Any two must differ by at least 10, and by at least 4 under simulated protanopia, deuteranopia and tritanopia (Machado 2009, full strength). About 2.3 is just noticeable side by side. A dot read at a glance needs several times that. The earlier palettes failed here: two blues 3.8 apart, and in one draft the accent and in progress were the same brown. A theme that fails is unreadable to someone scanning, and to colour-blind people first.

So:

- Never add a sixth state colour. Say a new state with a word, a shape or one of these five.
- Never use a state colour for decoration. A green that means "nice" makes `--done` mean less.
- Always say the state in words too. Colour is the fast read, never the only one.

```html specimen id=five-states title="The five, as a dot, a tint and a word"
<div class="ws-stack">
  <div class="ws-row">
    <span style="display: inline-flex; align-items: center; gap: var(--space-2)"
      ><span
        style="width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--accent)"
      ></span
      >Your move</span
    >
    <span style="display: inline-flex; align-items: center; gap: var(--space-2)"
      ><span
        style="width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--in-progress)"
      ></span
      >In progress</span
    >
    <span style="display: inline-flex; align-items: center; gap: var(--space-2)"
      ><span
        style="width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--danger)"
      ></span
      >Stalled</span
    >
    <span style="display: inline-flex; align-items: center; gap: var(--space-2)"
      ><span
        style="width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--done)"
      ></span
      >Done</span
    >
    <span style="display: inline-flex; align-items: center; gap: var(--space-2)"
      ><span
        style="width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--derived)"
      ></span
      >Oriel rule</span
    >
    <span style="display: inline-flex; align-items: center; gap: var(--space-2)"
      ><span
        style="width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--todo)"
      ></span
      >To do</span
    >
  </div>
  <div class="ws-row">
    <span
      style="padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: 1.25rem"
      >Needs review</span
    >
    <span
      style="padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--in-progress-soft); color: var(--in-progress); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: 1.25rem"
      >Agent working</span
    >
    <span
      style="padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: 1.25rem"
      >Not applied</span
    >
    <span
      style="padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--done-soft); color: var(--done); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: 1.25rem"
      >Done</span
    >
    <span
      style="padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--derived-soft); color: var(--derived); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: 1.25rem"
      >Oriel rule</span
    >
    <span
      style="padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--todo-soft); color: var(--todo); font-size: var(--text-xs); font-weight: var(--weight-medium); line-height: 1.25rem"
      >To do</span
    >
  </div>
</div>
```

The same states as the app draws them, with its own classes: a thread's state chip and dot (`.state-chip` and `.state-dot` in `window.css`), an item's status (`.status` in `window.css`), an Oriel rule's tag, and a problem line.

```html specimen id=in-the-app title="In the app: state chips, dots, an item's status, a rule and a problem"
<div class="ws-stack">
  <div class="ws-row">
    <span class="state-chip" data-state="working" data-waiting="review">Needs review</span>
    <span class="state-chip" data-state="working" data-waiting="agent">Agent working</span>
    <span class="state-chip" data-state="done">Done</span>
    <span class="state-chip" data-state="handed-off">Handed off</span>
    <span class="state-chip" data-state="dropped">Dropped</span>
  </div>
  <div class="ws-row">
    <span class="state-dot" data-state="working" data-waiting="review"></span>
    <span class="state-dot" data-state="working"></span>
    <span class="state-dot" data-state="done"></span>
    <span class="state-dot" data-state="dropped"></span>
    <span class="status" data-category="todo">To Do</span>
    <span class="status" data-category="in-progress">In Progress</span>
    <span class="status" data-category="done">Done</span>
  </div>
  <p class="derived-note">
    <span class="derived-tag">Oriel rule</span>
    marks a cluster Oriel made, which the source doesn't have. Each one shows its rule.
  </p>
  <p class="notice" data-tone="error">The window didn't load.</p>
</div>
```

## Tints: every -soft

Each state has a `-soft` tint for a fill behind its own colour: `--accent-soft`, `--todo-soft`, `--in-progress-soft`, `--done-soft`, `--danger-soft`, `--derived-soft`. Each is mixed from its colour by the theme's `--tint`, into `--surface` (`--accent-soft` in `window.css`). Graphite mixes 13% light and 16% dark, and Broadsheet 12% and 16%.

- Use a tint only behind its own colour: `--done` words on `--done-soft`. Each of those pairs passes 4.5:1.
- Don't put `--text` on a tint to make a coloured box. A tint means the state, so its words should be the state's.
- Don't mix a tint of your own with `color-mix()` in a rule. If a new one is needed, it's a shared token on `html`, mixed by `--tint`.

## Derived tokens

Derived tokens are set once, on `html`, from a theme's tokens. No theme sets them (decision 0034):

- `--focus`: the accent.
- `--ins` and `--ins-soft`: inserted words are done's colour.
- `--handed-off` and `--handed-off-soft`: handed off is a way of being finished, so it's drawn as done.
- `--derived-line`, `--sidebar-bg`, and `--scrim`, the dim under the drawer and the delete question. It's the ink at 32% in light, and the paper at 40% in dark.
- What [the bead](/components/bead) writes on its ink (decision 0056): `--bead-text`, `--bead-faint`, `--bead-ring`, `--bead-accent`, `--bead-working`, `--bead-done` and `--bead-danger`. In light the bead is the page's text colour, so each state colour is mixed 45% toward `--bg` to read on it; in the dark they're the theme's own, and the ring is `--line-strong`. Oriel's theme check holds each to 4.5:1 on `--bead`.

`--bead`, the ink itself, is the one colour token a theme sets that isn't a surface, a line, a text or a state: its text in light, and in the dark a near black deeper than the page, which no other token is. `--bead-radius` is the bead's shape: 1rem in Graphite, a pill on one line, and 2px in Broadsheet, a printed slip.

## Type colours, kept muted

`--type-story`, `--type-bug`, `--type-task`, `--type-epic` and `--type-other` colour the small mark before an item's key in Browse (`.type` in `window.css`). They're a state colour mixed 55% (the epic's 45%) toward `--line-strong`, so they're muted on purpose. "A source's own marks stay muted: kind is told by shape and name" (above `--type-story` in `window.css`). A bug is a dot and a story a square, so the colour is a hint, never the signal. Don't use them for anything but a kind's mark.

## Both themes

Every colour token, as the browser computes it in each theme and scheme, read from window.css now:

```live
colour
```

## Contrast

Every pair below is computed with Oriel's own contrast code, the same the theme check runs. The table flags a failure with ✗.

- **Text pairs need 4.5:1** (WCAG AA): every text token on every background, each state on its own tint, and `--on-accent` on the accent, `--done` and `--danger`.
- **The focus ring and the accent need 3:1** (WCAG 1.4.11, for a non-text mark) against every background. The ring and a primary button's fill are both the accent, so they must stand off whatever they sit on.
- **Hairlines are reported, not claimed.** `--line` and `--line-strong` sit well under 3:1 against `--bg` and `--surface`, in every theme. That's on purpose: Oriel's look is hairlines, and a hairline at 3:1 is a heavy rule.

What that means for a control's edge: a field or button whose only boundary is its `--line-strong` border doesn't meet 1.4.11 by its edge alone. Oriel's controls get there in other ways, and a new one must too:

- A button has a label in `--text` and, if primary, an accent fill. Its edge isn't what tells you it's a button.
- A text field has a visible label above it, a placeholder, or sits where a field is expected (the composer at the foot of a thread). Its focus ring is the accent, at 3:1 or more.
- A control that's only an edge, such as an empty checkbox or a switch's track, should use `--line-strong` at least, never `--line`, and an on state in the accent. See [Checkbox and radio](/components/checkbox-radio) and [Switch](/components/switch).

```live
contrast
```

## Oriel's theme check

The workshop runs Oriel's own `scripts/check-themes.ts` over the checkout it reads: contrast, the five states' separation (with the colour-blind simulations), and "values, not rules", which fails a rule with a literal colour.

```live
themecheck
```

## Rules

- **Do** pick a token by its role: `--text-muted` for supporting words, `--line-strong` for a control's edge.
- **Do** keep the accent for "your move". One primary per moment.
- **Do** say a state in words beside its colour.
- **Do** put a state's words on its own tint, and nothing else on it.
- **Don't** write a colour in a rule: no hex, `rgb()` or named colour. `transparent` and `currentColor` are fine.
- **Don't** add a state colour, or use one for decoration.
- **Don't** select on `data-theme` outside a theme block. A theme changes values, never rules.
- **Don't** rely on a hairline alone to show where a control is.
