---
title: Type
order: 20
summary: System fonts only, a five-step scale from --text-xs to --text-xl, three weights and three leadings. Serif for the thread, panel and page titles; every rem follows the Text size setting.
---

# Type

Oriel is a dense tool read for hours, so its type is small, plain and system-native. Every family, size, weight and leading is a token, and a rule may not write one as a literal: Oriel's theme check fails it (decision 0034).

## The fonts

Three stacks, all system fonts. Picking a theme never loads a font file, and no web font is added (decision 0034).

- `--font`, the system sans: everything by default. Rows, buttons, messages, fields, the sidebar.
- `--font-heading`, the serif: `Charter, "Iowan Old Style", Cambria, Georgia, serif`. Charter on macOS, Cambria on Windows, Georgia almost everywhere else. Only for **titles**: a thread's (`.thread-title` in `window.css`), the item panel's (`.panel-title` in `window.css`), a page's (`.page-title` in `window.css`) and the first run's (`.setup-title` in `window.css`). Broadsheet's section heads use it too, through `--section-head-font`. Rows stay sans.
- `--font-mono`: code and paths, such as code in an answer (`.reply code` in `window.css`), the path to Claude Code (`.path-label input` in `window.css`) and a diff's code. Not for keys like SYN-23. A key is the sans with tabular numbers (`.key` in `window.css`).

`--title-weight` is the titles' weight: 600 in Graphite and 400 (regular) in Broadsheet, where the serif carries the rank.

```html specimen id=fonts title="The three stacks"
<div class="ws-stack">
  <h1 class="page-title">Checkout v2: phone wallets and saved cards</h1>
  <p style="margin: 0">
    SYN-23 Pay with a phone wallet on the website is in progress, with no estimate.
  </p>
  <p style="margin: 0; font-family: var(--font-mono); font-size: var(--text-sm)">
    jira.listStories({ epicKey: "SYN-1" })
  </p>
</div>
```

## The scale

Five sizes, in rem, so each follows the person's Text size. The body is `--text-md`, 13px at the default size.

| Token       | Size at default | Use it for                                                                         |
| ----------- | --------------- | ---------------------------------------------------------------------------------- |
| `--text-xs` | 11px            | A state chip, an item's status, a count badge, an Oriel rule's tag                 |
| `--text-sm` | 12px            | Secondary lines: a key, a time, a hint, a button's label, Graphite's section heads |
| `--text-md` | 13px            | The body: rows, messages, fields. `body` sets it (`body` in `window.css`)          |
| `--text-lg` | 15px            | The brand, Broadsheet's section heads, the overview's counts on a narrow screen    |
| `--text-xl` | 18px            | Titles, and the × of a close button                                                |

```html specimen id=scale title="--text-xs to --text-xl"
<div class="ws-stack">
  <p style="margin: 0; font-size: var(--text-xs)">
    --text-xs · Needs review · 3 items · Oriel rule
  </p>
  <p style="margin: 0; font-size: var(--text-sm)">--text-sm · SYN-23 · 2 h ago · Mark done</p>
  <p style="margin: 0; font-size: var(--text-md)">
    --text-md · Pay with a phone wallet on the website
  </p>
  <p style="margin: 0; font-size: var(--text-lg)">--text-lg · Workstreams 7</p>
  <p style="margin: 0; font-size: var(--text-xl); font-family: var(--font-heading)">
    --text-xl · Estimate the unestimated checkout stories
  </p>
</div>
```

There's nothing above `--text-xl`. Oriel has no hero text, and a page's title is the largest thing on it. If something needs more rank, give it a rule above it or more space, not a bigger size.

## Weights

- `--weight-regular` (400): the body, a chip's name, a key.
- `--weight-medium` (500): a button's label, a state chip, the current page in the sidebar.
- `--weight-strong` (600): a name that leads a row, a section head, a count's number, the bold lead of a sentence ("**Disconnect Jira?**").

Three weights are enough. Don't use bold for a whole sentence: lead with a few strong words and let the rest be regular.

```html specimen id=weights title="Regular, medium, strong"
<div class="ws-row">
  <span style="font-weight: var(--weight-regular)">Gift cards</span>
  <span style="font-weight: var(--weight-medium)">Gift cards</span>
  <span style="font-weight: var(--weight-strong)">Gift cards</span>
</div>
```

## Leadings

- `--leading-tight` (1.25): a title or head over one or two lines.
- `--leading` (1.45): the body and every row. `body` sets it.
- `--leading-prose` (1.6): paragraphs meant to be read through, such as the first run's text, a connect step's help and the lede under a Settings section.

```html specimen id=leadings title="Tight, body, prose"
<div class="ws-row" style="align-items: start">
  <p style="margin: 0; max-width: 14rem; line-height: var(--leading-tight)">
    Its source hasn't answered for a while. Try again or dismiss it once it answers.
  </p>
  <p style="margin: 0; max-width: 14rem; line-height: var(--leading)">
    Its source hasn't answered for a while. Try again or dismiss it once it answers.
  </p>
  <p style="margin: 0; max-width: 14rem; line-height: var(--leading-prose)">
    Its source hasn't answered for a while. Try again or dismiss it once it answers.
  </p>
</div>
```

## Section heads, per theme

The overview's section heads (`.overview-head` in `window.css`) are the one place where the themes' type differs by more than a weight. Four tokens draw them:

- `--section-head-font`, a `font` shorthand. Graphite: strong `--text-sm` sans. Broadsheet: strong `--text-lg` serif, tight.
- `--section-head-case`: Graphite uppercase, Broadsheet as written.
- `--section-head-tracking`: Graphite 0.04em, Broadsheet 0.
- `--section-rule`, the rule above: Graphite a thin `--line-strong`, Broadsheet a thick rule in `--text`.

Its colour is `--text-muted` in every theme: the rule gives the sections their rank (decision 0034). Switch the workshop's theme to see both.

```html specimen id=section-head title="A section head, as the theme draws it"
<section class="overview-section" aria-label="Workstreams">
  <h2 class="overview-head"><span>Workstreams</span><span class="overview-count">7</span></h2>
</section>
```

## Text size

Settings › Appearance has a **Text size**: Small, Default or Large (`textSizeNames` in `packages/web/src/settings-page.tsx`). It sets `data-text-size` on the root, and the root's font size follows (`html[data-text-size]` in `window.css`):

- `small`: 93.75%, so 15px to the rem.
- default: no attribute, 100%.
- `large`: 112.5%, so 18px to the rem.

Every size and space in window.css is in rem, so the whole window scales with it: type, padding, rows, the sidebar's width. Breakpoints are in px and don't move. The server writes the attribute, so the first paint is right.

The workshop's **Text size** control at the top sets the same attribute on every specimen. Check anything you draw at Large: a row that fits at Default may wrap, and a bar may push past a narrow screen's edge. That's why a chat input's field is `width: 100%; min-width: 0` (`.chat-input-field` in `window.css`).

## Every type token

```live
tokens type
```

## Rules

- **Do** use the scale's tokens for every size. No literal px, rem or em in `font-size`.
- **Do** use the serif only for the thread, panel and page titles (and Broadsheet's section heads, through their token).
- **Do** set a key in the sans with `font-variant-numeric: tabular-nums`, as `.key` does.
- **Do** look at what you draw at the Large text size.
- **Don't** load a font, or add a family to a stack.
- **Don't** go above `--text-xl`. Give rank with a rule or space instead.
- **Don't** set `font-weight: bold` or a number. Use the three weight tokens.
- **Don't** use mono for anything that isn't code or a path.
