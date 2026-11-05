---
title: Space, shape and elevation
order: 30
summary: The space scale, row density per theme, three radii, two border widths, two shadows and the scrim. Plus the layer scale, what stacks over what.
---

# Space, shape and elevation

Space is the one category where window.css still writes literals. Decision 0034 allows them: "a fixed width, an icon's size or a nudge under `--space-1` stays in its rule, where no theme needs to reach it". Everything a theme changes (density, corners, rules and shadows) is a token.

## The space scale

Six steps, in rem, so they follow the Text size. There's no `--space-5` or `--space-7`.

| Token       | At default | Use it for                                                                                                   |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `--space-1` | 4px        | Between a label and its hint, between lines inside a row                                                     |
| `--space-2` | 8px        | Between an icon and its words, between chips, a row's padding on a small control                             |
| `--space-3` | 12px       | A row's side padding, between buttons in a group, a page's padding on a narrow screen. `--inset-top` is this |
| `--space-4` | 16px       | Between the parts of a page or panel                                                                         |
| `--space-6` | 24px       | Between sections, a page's side padding                                                                      |
| `--space-8` | 32px       | The foot of a page or panel                                                                                  |

```html specimen id=scale title="The space scale"
<div class="ws-stack">
  <div class="ws-row">
    <span
      style="display: inline-block; width: var(--space-1); height: 1rem; background: var(--accent-soft); border: var(--border-thin) solid var(--accent)"
    ></span>
    <code>--space-1</code>
  </div>
  <div class="ws-row">
    <span
      style="display: inline-block; width: var(--space-2); height: 1rem; background: var(--accent-soft); border: var(--border-thin) solid var(--accent)"
    ></span>
    <code>--space-2</code>
  </div>
  <div class="ws-row">
    <span
      style="display: inline-block; width: var(--space-3); height: 1rem; background: var(--accent-soft); border: var(--border-thin) solid var(--accent)"
    ></span>
    <code>--space-3</code>
  </div>
  <div class="ws-row">
    <span
      style="display: inline-block; width: var(--space-4); height: 1rem; background: var(--accent-soft); border: var(--border-thin) solid var(--accent)"
    ></span>
    <code>--space-4</code>
  </div>
  <div class="ws-row">
    <span
      style="display: inline-block; width: var(--space-6); height: 1rem; background: var(--accent-soft); border: var(--border-thin) solid var(--accent)"
    ></span>
    <code>--space-6</code>
  </div>
  <div class="ws-row">
    <span
      style="display: inline-block; width: var(--space-8); height: 1rem; background: var(--accent-soft); border: var(--border-thin) solid var(--accent)"
    ></span>
    <code>--space-8</code>
  </div>
</div>
```

### Literals left in rules

[The drift report](/drift) counts what's left (its section 1):

- **55 rem literals** in padding, margin, gap and inset, not through `--space-*`. Most are under `--space-1`: 0.125rem 13 times, then 0.1875rem, 0.25rem and 0.3125rem in small controls' vertical padding. `.button`'s own `padding: 0.25rem var(--space-3)` (`.button` in `window.css`) is one. The rest are page ends (6rem, 7rem) and gutters kept free for a button placed over a row.
- **31 px literals** outside the token blocks: hairline gaps of 1px and 2px, the visually-hidden 1px, a sketch frame's heights, the focus ring's 2px offset, and a few one-offs.

They're allowed, but a new one should have a reason. Reach for the scale first. A nudge under 4px is fine as a literal. A gap you'd want a theme to change isn't.

## Density: rows per theme

Density is two tokens, and they're all a theme changes (decision 0034):

- `--row`: a row's least height. Browse's item rows (`.item` in `window.css`) and a workstream's member rows (`.member` in `window.css`). Graphite 2rem, Broadsheet 2.25rem.
- `--row-pad`: the block padding of an overview row (`.overview-row` in `window.css`). Graphite 0.375rem, Broadsheet 0.5rem.

Graphite is compact, for a long day of scanning. Broadsheet is roomier, like a printed page. Use `--row` for a new list's row height, so it follows the theme, never a literal.

```html specimen id=density title="An overview list at the theme's density"
<section class="overview-section" aria-label="In progress, by person">
  <h2 class="overview-head">
    <span>In progress, by person</span><span class="overview-count">3</span>
  </h2>
  <ul class="overview-rows">
    <li class="overview-row overview-person">
      <a class="overview-title" href="#amara">Amara Okafor</a>
      <span class="overview-sub">7 · Checkout v2: phone wallets and saved cards (2)</span>
    </li>
    <li class="overview-row overview-person">
      <a class="overview-title" href="#farid">Farid Haddad</a>
      <span class="overview-sub">4 · Gift cards (1)</span>
    </li>
    <li class="overview-row overview-person">
      <a class="overview-title" href="#dara">Dara Nikolaidis</a>
      <span class="overview-sub">3</span>
    </li>
  </ul>
</section>
```

```live
tokens space
```

## Radius

Three tokens, and a dot. Decision 0034 removed `--radius-xl` and the 999px pills.

- `--radius-sm`: small marks and tags, such as an item's status, a line mark, a diff's word.
- `--radius`: controls: a button, a field, an icon button, a nav link.
- `--radius-lg`: containers: a list frame, the composer, a card, the selection bar, the window chat's sheet. Also the state chip and count badge, which Graphite rounds most.
- A dot is `border-radius: 50%`, the one literal radius allowed. It stays round in every theme.

Graphite rounds them 4px, 6px and 8px. Broadsheet squares them: 0, 2px and 4px.

```html specimen id=radius title="--radius-sm, --radius, --radius-lg, and a dot"
<div class="ws-row">
  <span
    style="display: inline-block; width: 3rem; height: 2rem; border: var(--border-thin) solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface)"
  ></span>
  <span
    style="display: inline-block; width: 3rem; height: 2rem; border: var(--border-thin) solid var(--line-strong); border-radius: var(--radius); background: var(--surface)"
  ></span>
  <span
    style="display: inline-block; width: 3rem; height: 2rem; border: var(--border-thin) solid var(--line-strong); border-radius: var(--radius-lg); background: var(--surface)"
  ></span>
  <span class="state-dot" data-state="done"></span>
</div>
```

## Borders and rules

- `--border-thin` (1px): every hairline. A row's divider, a field's edge, a list frame.
- `--border-thick` (2px): the focus ring, Broadsheet's section rule and ask-bar mark, a quote's bar, and Oriel's own notes.
- `--section-rule`: the rule above an overview section's head. Graphite: a thin `--line-strong`. Broadsheet: a thick rule in `--text`.
- `--list-frame`: the border round an overview list. Graphite frames each list in `--line`, on `--list-bg` (its surface). Broadsheet has none, and its lists sit open on the page.
- `--ask-mark`: the ask bar's start edge. None in Graphite, a thick accent rule in Broadsheet (`.ask-bar` in `window.css`).

A border's width is always a token. "A ring (a shadow with no blur, in a token's colour) is a border, not elevation" (decision 0034), so a `box-shadow: 0 0 0 var(--border-thin) var(--line)` ring is fine.

```live
tokens shape
```

## Elevation

Two shadows and a scrim. Most of Oriel is flat: things sit on the page, divided by hairlines. Elevation is only for what floats over the page.

- `--shadow-sm`: barely lifted. The current page's nav link (`.nav-link[aria-current="page"]` in `window.css`) and the switch's knob (`.switch-knob` in `window.css`).
- `--shadow`: floats over the page. The item panel over the page (`.item-panel` in `window.css`; it loses it when it sits beside the page at 1100px and up), the window chat (`.window-chat` in `window.css`), the narrow screen's drawer, a context menu (`.context-menu` in `window.css`), a tooltip (`.tooltip` in `window.css`), the delete question (`.confirm` in `window.css`), the bead (`.bead` in `window.css`), the selection bar (`.selection-bar` in `window.css`) and a thread's composer (`.composer` in `window.css`).
- `--scrim`: dims the page under the drawer (`.drawer-backdrop`) and the delete question (`.confirm::backdrop` in `window.css`). The ink at 32% in light, the paper at 40% in dark.

Shadows are shared values today: neither theme sets its own, but each scheme does. Dark shadows are much heavier, since a soft shadow doesn't show on a dark page.

```html specimen id=elevation title="Flat, --shadow-sm, --shadow"
<div class="ws-row" style="padding: var(--space-4)">
  <span
    style="display: inline-grid; place-items: center; width: 7rem; height: 4rem; border: var(--border-thin) solid var(--line); border-radius: var(--radius-lg); background: var(--surface); font-size: var(--text-sm)"
    >Flat</span
  >
  <span
    style="display: inline-grid; place-items: center; width: 7rem; height: 4rem; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); font-size: var(--text-sm)"
    >--shadow-sm</span
  >
  <span
    style="display: inline-grid; place-items: center; width: 7rem; height: 4rem; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow); font-size: var(--text-sm)"
    >--shadow</span
  >
  <span
    style="display: inline-grid; grid-template-columns: 1fr 1fr; width: 14rem; height: 4rem; border: var(--border-thin) solid var(--line); border-radius: var(--radius-lg); overflow: hidden; background: var(--surface); font-size: var(--text-sm)"
    ><span style="display: grid; place-items: center">A page</span
    ><span style="display: grid; place-items: center; background: var(--scrim)"
      >Under --scrim</span
    ></span
  >
</div>
```

The last tile is a surface with the scrim over its right half, as the page looks under the drawer. In dark the scrim is the paper at 40%, so over a dark surface it barely shows (look at Broadsheet dark): there, the drawer's and the dialog's own shadow and edge do most of the separating.

```live
tokens elevation
```

## Layers (z-index)

What stacks over what is one scale of shared tokens on `html` (`--layer-raised` in `window.css`), lowest first. A rule's `z-index` is always one of them, never a number:

| Token            | Value | What                                     | Where                                               |
| ---------------- | ----- | ---------------------------------------- | --------------------------------------------------- |
| `--layer-raised` | 1     | A part over its sibling inside one thing | `.anchor-pick` and `.bead` in `window.css`          |
| `--layer-bar`    | 3     | The narrow screen's bar                  | `.bar` in `window.css`                              |
| `--layer-float`  | 4     | The selection bar                        | `.selection-bar` in `window.css`                    |
| `--layer-sticky` | 5     | The sidebar, sticky                      | `.sidebar` in `window.css`                          |
| `--layer-sheet`  | 18    | The window chat                          | `.window-chat` in `window.css`                      |
| `--layer-panel`  | 19    | The item panel, over the window chat     | `.item-panel` in `window.css`                       |
| `--layer-veil`   | 20    | The drawer's scrim, and the drop veil    | `.drawer-backdrop` and `.drop-veil` in `window.css` |
| `--layer-drawer` | 21    | The sidebar as a drawer                  | `.sidebar` in `window.css`                          |
| `--layer-toast`  | 22    | The bead, over everything in the window  | `.bead-wrap` in `window.css`                        |

`--layer-raised` only orders things inside one stacking context, such as the bead over its under-layer; the rest order the window's own layers. Menus, tooltips and dialogs need none: they open in the top layer, as popovers or a modal. A new layer should too, if it can. z-index isn't a theme value, so no theme sets these.

## Rules

- **Do** use the space scale for every gap a theme or a reader might want to change.
- **Do** use `--row` and `--row-pad` for a list row's height and padding, so it follows the theme's density.
- **Do** pick a radius by what the thing is: a mark, a control or a container.
- **Do** keep elevation for what floats: a panel, a sheet, a menu, a toast.
- **Don't** write a literal radius (but a dot's 50%), border width or shadow. The theme check fails it.
- **Don't** add a pill radius. Square corners are three tokens.
- **Don't** give a card on the page a shadow to make it stand out. Use a hairline or space.
- **Don't** write a z-index as a number. Use a `--layer-*` token, add one between two if nothing fits, and prefer the top layer.
